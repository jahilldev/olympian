"""worker_guard — keep the IMPLEMENT/REVISE primary an orchestrator: delegate edits, don't bloat
on big reads.

The primary may READ files (to verify a sub-agent's work or to quote a region when instructing
one), but it must not EDIT them, and it must not slurp whole large files into its context. Two
mechanisms, both primary-only (sub-agents are never affected — they edit and read in full):

  * BLOCK the write path — write_file / patch, plus file-mutating shell commands (`sed -i`, output
    redirects (> / >>), tee, mv/cp/rm/…). Test/build commands and harmless redirects (2>&1,
    > /dev/null) are left alone. Enforced via pre_tool_call.
  * BLOCK code execution — execute_code / run_python / etc. Arbitrary code is a back door around
    BOTH guards above: it can `open(p).read()` whole files (uncapped context bloat) and
    `open(p,"w").write(...)` to edit them (bypassing the write block). The primary delegates code
    runs to a sub-agent; only sub-agents may execute code. Enforced via pre_tool_call.
  * BLOCK git history/state commands — `git commit` / `git push` in a terminal command, for EVERY
    agent (primary AND sub-agents, unlike the primary-only guards above), since the orchestrator
    owns all git (it stages/commits/pushes); an agent commit would collide with that. Read-only git
    (diff/log/status) is left alone so a reviewer can inspect the branch. Enforced via pre_tool_call.
  * CAP large reads — a read_file result over N lines (or one Hermes already truncated) is clipped
    (for the primary only) with a note telling it to delegate a survey or re-read a tight
    offset+limit range. A verification or quote-a-function read is well under the cap; only a
    wholesale survey-by-reading gets clipped, which is exactly the work that should be delegated.
    Enforced via transform_tool_result. The cap is PRIMARY_READ_MAX_LINES (default 300), forwarded
    into the container by the service.

We cannot remove the write tools from the parent's toolset — Hermes caps a child's toolset to a
subset of the parent's (see delegate_tool's intersection), so that would strip editing from
sub-agents too. Instead we keep the tools and BLOCK them for the primary only, via a pre_tool_call
directive. The prompt tells the model they're disabled so it delegates up front.

Primary vs sub-agent is decided by task_id without relying on call ordering: the first tool call in
the process is the parent's (a child only exists after a delegate_task), and any task_id seen WHILE a
delegation is in flight is a sub-agent's. The hooks never raise — a guard failure must not break a
run (it just declines to block).
"""
from __future__ import annotations

import json
import os
import re
import shlex
import sys
import threading
from typing import Any, Optional

_WORKER_PHASES = {"IMPLEMENT", "REVISE"}
# Write tools — the primary may still read (read_file/search_files/cat) to verify a sub-agent.
_BLOCKED = {"write_file", "patch"}
# Code-execution tools — a back door that can read AND write files outside the delegation model, so
# the primary is blocked from all of them (sub-agents may run code). Names cover Hermes variants;
# any that don't exist are simply never seen.
_CODE_EXEC = {
    "execute_code", "run_code", "run_python", "python", "code_interpreter", "ipython", "jupyter",
}

# Read tools whose result is capped for the primary (see _on_transform_tool_result). Both names
# exist in Hermes; their result is JSON with a "content" field holding the (line-numbered) text.
_READ_TOOLS = {"read_file", "read"}
_DEFAULT_PRIMARY_READ_MAX_LINES = 300

# Shell commands that mutate the filesystem (checked per pipeline segment, ignoring a leading `cd`).
_WRITE_CMDS = {
    "tee", "mv", "cp", "rm", "rmdir", "touch", "mkdir", "dd", "truncate", "install", "ln",
    "patch", "chmod", "chown",
}
# A redirect operator with its target: optional leading fd (or &), > or >>, then the target token.
# The target stops at shell separators (; | & ) < >) so a trailing operator isn't swallowed —
# otherwise `2>/dev/null;` captures `/dev/null;` and the /dev/null exemption misses.
_REDIR = re.compile(r"(?:\d*|&)\s*>>?\s*([^\s;|&)<>]+)")
_SEGMENTS = re.compile(r"\|\||&&|;|\|")
# A whole single- or double-quoted span (handles backslash-escaped quotes inside).
_QUOTED = re.compile(r"\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'")


def _strip_quoted(cmd: str) -> str:
    """Replace quoted spans with a single placeholder token so their CONTENTS can't be misread as
    shell operators or commands — e.g. an echoed ``-->`` arrow looking like a ``>`` redirect, a
    quoted ``;`` mis-splitting segments, or the word ``rm`` inside a message. The placeholder is a
    non-space token, so a real redirect to a quoted target (``> "out.txt"``) still presents a
    target and is still caught as a write."""
    return _QUOTED.sub("Q", cmd)

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "primary": None,  # the primary agent's task_id, once known
    "active": 0,  # in-flight delegate_task calls
    "subagents": set(),  # task_ids identified as delegated sub-agents
}


def _phase_ok() -> bool:
    return (os.environ.get("OLYMPIAN_PHASE") or "").strip().upper() in _WORKER_PHASES


def _primary_read_max_lines() -> int:
    try:
        v = int(os.environ.get("PRIMARY_READ_MAX_LINES", ""))
        return v if v > 0 else _DEFAULT_PRIMARY_READ_MAX_LINES
    except Exception:
        return _DEFAULT_PRIMARY_READ_MAX_LINES


def _is_subagent(task_id: str) -> bool:
    """True only for a task_id we've positively identified as a delegated sub-agent (registered by
    on_pre_tool_call before the tool ran). Everything else — including the top-level primary, whose
    task_id is empty (`""`) — is treated as NOT a sub-agent. Detection is by exclusion: we can't
    rely on a positive primary id, because the primary often has none."""
    with _LOCK:
        return bool(task_id) and task_id in _STATE["subagents"]


def _has_write_redirect(cmd: str) -> bool:
    for m in _REDIR.finditer(cmd):
        target = m.group(1).strip("'\"")
        if target == "/dev/null" or re.fullmatch(r"&?\d+", target):
            continue  # > /dev/null or an fd dup (2>&1, >&2) — not a file write
        return True
    return False


def _has_write_command(cmd: str) -> bool:
    for seg in _SEGMENTS.split(cmd):
        seg = seg.strip()
        if not seg or seg.startswith("cd "):
            continue
        try:
            parts = shlex.split(seg)
        except Exception:
            parts = seg.split()
        if not parts:
            continue
        word = parts[0]
        if word in _WRITE_CMDS:
            return True
        if word == "sed" and any(p == "-i" or p.startswith("-i") for p in parts[1:]):
            return True  # in-place edit; plain sed is a read/filter
    return False


def _is_file_write_command(cmd: Optional[str]) -> bool:
    cmd = (cmd or "").strip()
    if not cmd:
        return False
    # Neutralise quoted content first — only unquoted text can be a real redirect/command.
    cmd = _strip_quoted(cmd)
    return _has_write_redirect(cmd) or _has_write_command(cmd)


# git sub-commands no agent may run — the orchestrator owns all git history/state (it stages,
# commits and pushes for you). Read-only git (diff/log/show/status/…) is deliberately NOT here, so
# a reviewer can still inspect the branch.
_BLOCKED_GIT_SUBCOMMANDS = {"commit", "push"}
# git global options that take a value, so the subcommand scanner skips their argument too.
_GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}


def _git_subcommand(parts: list[str]) -> Optional[str]:
    """Given shlex tokens whose first token is `git`, return the subcommand (e.g. commit/push),
    skipping global options like `-C <dir>` / `-c <kv>`. None if no subcommand is present."""
    i = 1
    while i < len(parts):
        tok = parts[i]
        if tok in _GIT_OPTS_WITH_ARG:
            i += 2  # option plus its separate-token value
            continue
        if tok.startswith("-"):
            i += 1  # `--git-dir=…` (attached value) or a valueless global flag
            continue
        return tok
    return None


def _is_blocked_git_command(cmd: Optional[str]) -> bool:
    """True when any pipeline segment invokes a forbidden git subcommand (commit/push). Quote-aware
    (an echoed "git commit" in a string is ignored) and tolerant of a leading `VAR=val` env prefix."""
    cmd = _strip_quoted((cmd or "").strip())
    if not cmd:
        return False
    for seg in _SEGMENTS.split(cmd):
        seg = seg.strip()
        if not seg:
            continue
        try:
            parts = shlex.split(seg)
        except Exception:
            parts = seg.split()
        idx = 0
        while idx < len(parts) and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", parts[idx]):
            idx += 1  # skip `FOO=bar git …` env assignments
        if idx < len(parts) and parts[idx] == "git" and _git_subcommand(parts[idx:]) in _BLOCKED_GIT_SUBCOMMANDS:
            return True
    return False


def on_pre_tool_call(
    *, tool_name: str = "", task_id: str = "", args: Optional[dict] = None, **_: Any
) -> Any:
    if not _phase_ok():
        return None
    try:
        with _LOCK:
            if tool_name == "delegate_task":
                if _STATE["primary"] is None and task_id:
                    _STATE["primary"] = task_id  # only the primary delegates
                _STATE["active"] += 1
                return None

            # A tool call during an in-flight delegation, under a non-primary id, is a sub-agent's.
            if _STATE["active"] > 0 and task_id and task_id != _STATE["primary"]:
                _STATE["subagents"].add(task_id)
            if _STATE["primary"] is None and task_id:
                _STATE["primary"] = task_id  # first non-delegate tool call = the parent
            is_subagent = task_id in _STATE["subagents"]

        # Hard safety net on top of the prompt guidance: NO agent — primary OR sub-agent — runs git
        # history/state commands. The orchestrator stages, commits and pushes your work; an agent
        # commit/push would collide with that (e.g. leave nothing staged for the orchestrator's own
        # commit, or push an unreviewed state). Checked before the sub-agent exemption below.
        if tool_name == "terminal" and _is_blocked_git_command((args or {}).get("command")):
            return {
                "action": "block",
                "message": (
                    "`git commit` / `git push` are disabled — the orchestrator owns all git and "
                    "stages, commits and pushes your work for you. Just edit files (or delegate the "
                    "edit); never run git history/state commands. Read-only git (`git diff`, "
                    "`git log`, `git status`) is fine."
                ),
            }

        if is_subagent:
            return None  # sub-agents do the editing — never block them

        if tool_name in _BLOCKED:
            return {
                "action": "block",
                "message": (
                    f"`{tool_name}` is disabled for you (the orchestrator) — you must not edit files "
                    "yourself. Delegate this change to a sub-agent with delegate_task; it edits in its "
                    "own context and returns the result to you. (You can still read files directly to "
                    "verify a sub-agent's work.)"
                ),
            }

        if tool_name in _CODE_EXEC:
            return {
                "action": "block",
                "message": (
                    f"`{tool_name}` is disabled for you (the orchestrator). Executing code lets you "
                    "read whole files into your context and edit files on disk, bypassing the "
                    "delegation model. Delegate any code execution, file reading, or edits to a "
                    "sub-agent with delegate_task and work from its result. (You can still read "
                    "files directly with read_file to verify a sub-agent's work.)"
                ),
            }

        if tool_name == "terminal" and _is_file_write_command((args or {}).get("command")):
            return {
                "action": "block",
                "message": (
                    "You must not modify files through the shell (no in-place sed, > / >> redirects, "
                    "tee, mv/cp/rm, etc.) — terminal is for running tests/builds only. Delegate this "
                    "change to a sub-agent with delegate_task instead."
                ),
            }
    except Exception:
        return None
    return None


def on_transform_tool_result(
    *, tool_name: str = "", result: Any = None, task_id: str = "", **_: Any
) -> Optional[str]:
    """Cap an over-long read_file result for the PRIMARY only — truncating the JSON `content`
    to the line budget and appending a note to delegate the rest. Sub-agents are never capped, so
    they still read whole files to do the work. Returning a string replaces the result the model
    sees; None leaves it untouched. Fail-open — never raise.

    The primary is identified by EXCLUSION (not a known sub-agent), mirroring the write-block in
    on_pre_tool_call. A positive `_is_primary` id check used to gate this, but the top-level
    primary's task_id is empty (`""`), so that check was always false and the cap silently never
    fired — the bug this replaces."""
    if not _phase_ok() or tool_name not in _READ_TOOLS or not isinstance(result, str):
        return None
    try:
        if _is_subagent(task_id):
            return None

        data = json.loads(result)
        if not isinstance(data, dict):
            return None

        content = data.get("content")
        if not isinstance(content, str) or not content:
            return None

        cap = _primary_read_max_lines()
        lines = content.split("\n")
        over_line_cap = len(lines) > cap
        # Hermes may have already truncated by characters (long-line / minified files, or its own
        # char cap) while leaving the line count under ours — that read is still "large" and must
        # carry the delegate nudge, so trigger on either condition.
        already_truncated = bool(data.get("truncated"))
        if not over_line_cap and not already_truncated:
            return None

        body = "\n".join(lines[:cap]) if over_line_cap else content
        data["content"] = body + (
            f"\n\n… [olympian: this is a large read, capped to {cap} lines for you, the orchestrator, "
            "to protect your context. Delegate a survey of this file to a sub-agent via delegate_task "
            "and work from its summary, or re-read a specific offset+limit range to verify a change. "
            "Sub-agents are not capped.]"
        )
        data["truncated"] = True
        # The langfuse trace (and so the UI event card) is captured at post_tool_call, which runs
        # BEFORE this transform — so this cap is invisible there by construction. Emit a line to
        # stderr (captured into AgentRun.stderr) so the cap is verifiable for the model-facing result.
        sys.stderr.write(
            f"[worker_guard] capped read_file for primary: {len(lines)} lines -> {cap} "
            f"(phase={(os.environ.get('OLYMPIAN_PHASE') or '').strip()}, task_id={task_id!r})\n"
        )
        sys.stderr.flush()
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        return None


def on_post_tool_call(*, tool_name: str = "", **_: Any) -> Any:
    if not _phase_ok():
        return None
    try:
        if tool_name == "delegate_task":
            with _LOCK:
                _STATE["active"] = max(0, _STATE["active"] - 1)
    except Exception:
        pass
    return None


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_hook("transform_tool_result", on_transform_tool_result)
