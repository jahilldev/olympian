"""worker_guard — force the IMPLEMENT/REVISE primary to delegate every edit.

The primary may READ files (to verify a sub-agent's work), but it must not EDIT them: every change
goes through a sub-agent so the work is delegated, captured in PROGRESS.md's Findings, and the
primary's context stays manageable. Two block paths, both primary-only:

  * the write tools — write_file / patch
  * file-mutating shell commands — `sed -i`, output redirects (> / >>), tee, mv/cp/rm/…, so the
    primary can't bypass the tool block via terminal. Test/build commands and harmless redirects
    (2>&1, > /dev/null) are left alone.

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

import os
import re
import shlex
import threading
from typing import Any, Optional

_WORKER_PHASES = {"IMPLEMENT", "REVISE"}
# Write tools — the primary may still read (read_file/search_files/cat) to verify a sub-agent.
_BLOCKED = {"write_file", "patch"}

# Shell commands that mutate the filesystem (checked per pipeline segment, ignoring a leading `cd`).
_WRITE_CMDS = {
    "tee", "mv", "cp", "rm", "rmdir", "touch", "mkdir", "dd", "truncate", "install", "ln",
    "patch", "chmod", "chown",
}
# A redirect operator with its target: optional leading fd (or &), > or >>, then the target token.
_REDIR = re.compile(r"(?:\d*|&)\s*>>?\s*(\S+)")
_SEGMENTS = re.compile(r"\|\||&&|;|\|")

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "primary": None,  # the primary agent's task_id, once known
    "active": 0,  # in-flight delegate_task calls
    "subagents": set(),  # task_ids identified as delegated sub-agents
}


def _phase_ok() -> bool:
    return (os.environ.get("OLYMPIAN_PHASE") or "").strip().upper() in _WORKER_PHASES


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
    return _has_write_redirect(cmd) or _has_write_command(cmd)


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
