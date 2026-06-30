"""persist_state — durable working memory for Olympian agent runs.

Hermes keeps the todo list in memory (lost when a run crashes or exits early), and a delegated
subagent's findings only ever reach the parent as a one-off summary. This plugin persists both to
``.olympian/PROGRESS.md`` deterministically — driven by tools the model already uses reliably — so a
re-run resumes instead of starting over:

  * the PRIMARY agent's ``todo`` list  -> the "## Checklist" section (rewritten on each update)
  * every ``delegate_task`` result     -> appended to the "## Findings" section (capped)

Primary vs sub-agent is decided WITHOUT relying on call ordering:
  * Only the primary agent can call ``delegate_task`` (spawn depth is capped at 1), so the
    ``delegate_task`` pre-hook reveals the primary's ``task_id`` authoritatively — and fires before
    the child's own tool calls begin.
  * ``delegate_task`` blocks the parent until its children finish, so any tool call seen WHILE a
    delegation is in flight, under a different ``task_id``, is definitively a sub-agent. We record
    those ids and never mirror their todos, so a child can't clobber the primary checklist.

``task_id`` is the executing agent's id, correctly propagated across worker threads by Hermes, so
this holds regardless of which thread a call runs on. The hooks never raise — a mirror failure must
never break a run.
"""
from __future__ import annotations

import json
import os
import re as _re
import threading
from typing import Any

_PROGRESS_REL = os.path.join(".olympian", "PROGRESS.md")
_CHECKLIST_HEADER = "## Checklist"
_FINDINGS_HEADER = "## Findings"
_FINDINGS_BUDGET = 50_000  # max chars kept in Findings (drop oldest beyond this)
_ENTRY_CAP = 12_000  # max chars of any single subagent report (holds a thorough survey whole)
_TRIM_MARKER = "_…older findings trimmed…_"
# Matches the start of each Findings entry ("### 12. …") so trimming drops whole entries.
_ENTRY_START_RE = _re.compile(r"(?m)^### \d+\.")

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "primary": None,  # the primary agent's task_id, once known
    "active": 0,  # in-flight delegate_task calls
    "subagents": set(),  # task_ids identified as delegated sub-agents
    "delegations": 0,  # running count, for Findings entry numbering
    # In-memory source of truth for the file's two sections. We recompose the whole file from these
    # on every write rather than re-reading it. PROGRESS.md is git-excluded, so a build/test step
    # (e.g. `git clean -fdx`) or stray cleanup can delete it mid-run; keeping the content in memory
    # lets us (a) never clobber a surviving section with an empty placeholder, and (b) restore the
    # whole file on the very next tool call if it has gone missing (see _heal).
    "checklist": None,  # str once known; None = not yet seeded from disk
    "findings": None,
}


# ── workspace / file helpers ────────────────────────────────────────────────


def _workspace_dir() -> str:
    try:
        from agent.runtime_cwd import resolve_agent_cwd  # type: ignore

        return str(resolve_agent_cwd())
    except Exception:
        return os.getcwd()


def _progress_path() -> str:
    return os.path.join(_workspace_dir(), _PROGRESS_REL)


def _read() -> str:
    try:
        with open(_progress_path(), "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def _split(text: str) -> tuple[str, str]:
    """Return (checklist_body, findings_body) parsed from an existing PROGRESS.md."""
    checklist, findings = "", ""
    head = text
    if _FINDINGS_HEADER in text:
        head, findings = text.split(_FINDINGS_HEADER, 1)
        findings = findings.strip()
    if _CHECKLIST_HEADER in head:
        checklist = head.split(_CHECKLIST_HEADER, 1)[1].strip()
    return checklist, findings


def _trim_findings(findings: str) -> str:
    """Cap Findings at _FINDINGS_BUDGET by dropping the OLDEST WHOLE entries (### N. blocks),
    never slicing mid-entry — a half-cut code block fed back to the agent is worse than missing
    history. Keeps as many newest entries as fit, with a marker noting older ones were dropped."""
    findings = findings.strip()
    if len(findings) <= _FINDINGS_BUDGET:
        return findings

    marker = f"{_TRIM_MARKER}\n\n"
    budget = _FINDINGS_BUDGET - len(marker)
    starts = [m.start() for m in _ENTRY_START_RE.finditer(findings)]

    # No recognisable entry boundaries — fall back to a hard tail slice (best effort).
    if not starts:
        return marker + findings[-budget:].lstrip()

    # Earliest entry whose tail fits the budget; always keep at least the last entry
    # (each is capped at ~_ENTRY_CAP, so the newest entry alone comfortably fits).
    kept = starts[-1]
    for s in starts:
        if len(findings) - s <= budget:
            kept = s
            break

    return marker + findings[kept:].lstrip()


def _write(checklist: str, findings: str) -> None:
    findings = _trim_findings(findings)
    body = (
        f"{_CHECKLIST_HEADER}\n{checklist or '_(no checklist yet)_'}\n\n"
        f"{_FINDINGS_HEADER}\n{findings or '_(none yet)_'}\n"
    )
    path = _progress_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(body)
    os.replace(tmp, path)  # atomic — a crashed write never leaves a half file


# ── in-memory state: seed once from disk, then recompose from memory ─────────


def _seed() -> None:
    """One-time seed of the in-memory sections from disk, so a process that resumes an existing
    PROGRESS.md inherits its content before appending. After this, memory is authoritative."""
    if _STATE["checklist"] is None and _STATE["findings"] is None:
        checklist, findings = _split(_read())
        _STATE["checklist"] = checklist
        _STATE["findings"] = findings
        # Continue Findings numbering from the highest existing entry so a retry (a fresh process
        # that resumes this file) doesn't restart at 1 and produce a jumbled "1, 2, 1" sequence.
        nums = [int(m) for m in _re.findall(r"(?m)^### (\d+)\.", findings or "")]
        _STATE["delegations"] = max(nums) if nums else 0


def _flush() -> None:
    _write(_STATE["checklist"] or "", _STATE["findings"] or "")


def _heal() -> None:
    """If the file has gone missing (e.g. a build's `git clean`), restore it from memory. Cheap:
    an existence check on every tool call, a write only when it's actually gone."""
    if _STATE["checklist"] or _STATE["findings"]:
        if not os.path.exists(_progress_path()):
            _flush()


# ── rendering ───────────────────────────────────────────────────────────────


def _checkbox(status: Any) -> str:
    return {"completed": "[x]", "in_progress": "[~]", "cancelled": "[-]"}.get(str(status), "[ ]")


def _render_checklist(result: Any) -> str:
    items = result
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception:
            return items.strip()
    if isinstance(items, dict):
        items = items.get("todos") or items.get("items") or []
    if not isinstance(items, list):
        return ""
    lines: list[str] = []
    for it in items:
        if isinstance(it, dict):
            content = str(it.get("content", "")).strip()
            if content:
                lines.append(f"- {_checkbox(it.get('status'))} {content}")
        elif isinstance(it, str) and it.strip():
            lines.append(f"- [ ] {it.strip()}")
    return "\n".join(lines)


_THINK_TAGS = _re.compile(r"<(antThinking|think|thinking|reasoning)>.*?</\1>", _re.DOTALL | _re.IGNORECASE)


def _strip_thinking(text: str) -> str:
    return _THINK_TAGS.sub("", text).strip()


_HEADING_RE = _re.compile(r"^[ \t]*(#{1,6})[ \t]+(.+?)[ \t]*#*$")


def _relevel_headings(text: str, base: int = 4) -> str:
    """Re-base the headings in captured (model-authored) goal/report text so the shallowest sits at
    ``base`` — one level below a "### N." Findings entry (h3) — while preserving the content's own
    relative hierarchy. This keeps the agent's structure intact AND nested correctly under the entry,
    so its headings never sit above, or collide with, the structural ## Findings / ### N. markers
    when the file is injected into a prompt. Headings inside fenced code blocks are left untouched.
    """
    lines = text.split("\n")

    def heading_levels():
        in_fence = False
        for line in lines:
            s = line.lstrip()
            if s.startswith("```") or s.startswith("~~~"):
                in_fence = not in_fence
                continue
            m = None if in_fence else _HEADING_RE.match(line)
            if m:
                yield len(m.group(1))

    levels = list(heading_levels())
    if not levels:
        return text
    shift = base - min(levels)

    out: list[str] = []
    in_fence = False
    for line in lines:
        s = line.lstrip()
        if s.startswith("```") or s.startswith("~~~"):
            in_fence = not in_fence
            out.append(line)
            continue
        m = None if in_fence else _HEADING_RE.match(line)
        if m:
            level = max(1, min(6, len(m.group(1)) + shift))
            out.append("#" * level + " " + m.group(2).strip())
        else:
            out.append(line)
    return "\n".join(out)


_DONE = {"completed", "complete", "success", "succeeded", "ok"}


def _one_result(r: Any) -> str:
    """Render a single child task result. Only a COMPLETED child contributes its summary; an
    incomplete one (timeout / max_iterations / error / interrupted) is recorded as a short marker
    instead of its truncated mid-thought narration — capturing that pollutes Findings."""
    if not isinstance(r, dict):
        return str(r)
    status = str(r.get("status") or "").strip().lower()
    exit_reason = str(r.get("exit_reason") or "").strip().lower()
    # No status fields at all (older/other shapes) → treat as a plain result.
    if (status or exit_reason) and status not in _DONE and exit_reason not in _DONE:
        why = status or exit_reason or "unknown"
        detail = str(r.get("error") or "").strip() or "cut off before producing a final report"
        return f"⚠️ Sub-agent did not finish (status: {why}) — {detail[:200]}"
    return str(r.get("summary") or r.get("result") or r.get("error") or "")


def _summarise_delegation(result: Any) -> str:
    one = _one_result

    if isinstance(result, str):
        try:
            result = json.loads(result)
        except Exception:
            return _strip_thinking(result)[:_ENTRY_CAP]

    # delegate_task returns {"results": [ {summary,...}, ... ], "note": ...}; older/other shapes
    # may be a bare list or dict.
    if isinstance(result, dict) and isinstance(result.get("results"), list):
        items = result["results"]
    elif isinstance(result, list):
        items = result
    else:
        items = [result]

    text = "\n".join(p for p in (one(r) for r in items) if p.strip())
    text = _strip_thinking(text)
    text = _relevel_headings(text)
    if len(text) > _ENTRY_CAP:
        text = text[:_ENTRY_CAP].rstrip() + " …[trimmed]"
    return text


def _heading_label(goal: Any, cap: int = 100) -> str:
    """A short one-line label for a Findings heading. The primary writes the whole task as a single
    long line, so we take the first line, cut it at the first sentence/clause boundary if that is
    short enough, then hard-cap on a word boundary."""
    line = str(goal or "").strip().splitlines()
    line = line[0].strip() if line else ""
    # Cut at the first clause/sentence boundary that is actually present and short enough.
    for sep in (": ", ". "):
        if sep in line:
            head = line.split(sep, 1)[0]
            if 0 < len(head) <= cap:
                return head
    if len(line) > cap:
        line = line[:cap].rsplit(" ", 1)[0].rstrip(" ,.;:") + "…"
    return line


def _is_dispatch_ack(result):
    """A background delegation's post-hook result is only a dispatch acknowledgement, not the
    subagent's report (that arrives asynchronously) — recognise it so we don't record it."""
    obj = result
    if isinstance(obj, str):
        try:
            obj = json.loads(obj)
        except Exception:
            return False
    if isinstance(obj, list):
        obj = obj[0] if obj else None
    return isinstance(obj, dict) and (
        obj.get("status") == "dispatched"
        or obj.get("mode") == "background"
        or "delegation_id" in obj
    )


# ── classification (called under _LOCK) ─────────────────────────────────────


def _note_primary(task_id: str) -> None:
    if _STATE["primary"] is None and task_id:
        _STATE["primary"] = task_id


def _observe(task_id: str) -> None:
    # A tool call during an in-flight delegation, under a non-primary id, is a sub-agent's.
    if _STATE["active"] > 0 and task_id and task_id != _STATE["primary"]:
        _STATE["subagents"].add(task_id)


# Only IMPLEMENT/REVISE own the working-memory file. REVIEW, VERIFY, JUDGE, etc. run the same
# global plugin and share the workspace — without this gate a JUDGE (mid completion-loop) or a
# REVIEW would write its own todos over the IMPLEMENT/REVISE checklist. The orchestrator sets
# OLYMPIAN_PHASE per agent run (see agent.service.ts).
_WORK_PHASES = {"IMPLEMENT", "REVISE"}


def _is_work_phase() -> bool:
    return (os.environ.get("OLYMPIAN_PHASE") or "").strip().upper() in _WORK_PHASES


# ── hooks ───────────────────────────────────────────────────────────────────


def on_pre_tool_call(*, tool_name: str = "", task_id: str = "", **_: Any) -> None:
    if not _is_work_phase():
        return
    try:
        with _LOCK:
            if tool_name == "delegate_task":
                _note_primary(task_id)  # only the primary delegates → this id is the primary's
                _STATE["active"] += 1
            else:
                _observe(task_id)
    except Exception:
        pass


def on_post_tool_call(
    *, tool_name: str = "", args: Any = None, result: Any = None, task_id: str = "", **_: Any
) -> None:
    if not _is_work_phase():
        return
    try:
        with _LOCK:
            _seed()

            if tool_name == "delegate_task":
                _note_primary(task_id)
                _STATE["active"] = max(0, _STATE["active"] - 1)
                # Background delegations report back here only with a dispatch ack; the real
                # summary arrives async. Record real (foreground) results only.
                if not _is_dispatch_ack(result):
                    _STATE["delegations"] += 1
                    n = _STATE["delegations"]
                    goal_full = str(args.get("goal", "")).strip() if isinstance(args, dict) else ""
                    label = _heading_label(goal_full)
                    # Short heading for readability; the full goal is kept as body so no context is
                    # lost, then the subagent's report.
                    entry = f"### {n}. {label}".rstrip() + "\n"
                    if goal_full and goal_full != label:
                        entry += f"**Goal:** {_relevel_headings(goal_full)}\n\n"
                    entry += _summarise_delegation(result) + "\n"
                    prior = _STATE["findings"] or ""
                    _STATE["findings"] = (prior + "\n\n" + entry) if prior else entry
                    _flush()
            elif tool_name == "todo":
                _observe(task_id)
                if task_id not in _STATE["subagents"]:
                    checklist = _render_checklist(result)
                    if checklist:  # never overwrite a real checklist with an empty one
                        _STATE["checklist"] = checklist
                        _flush()

            # Any tool (e.g. a terminal `git clean`) may have removed the git-excluded file —
            # restore it from memory immediately so a later read never sees it missing.
            _heal()
    except Exception:
        pass  # mirroring must never break a run


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
    ctx.register_hook("post_tool_call", on_post_tool_call)
