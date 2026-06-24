"""worker_guard — force the IMPLEMENT/REVISE primary to delegate every edit.

The primary may READ files (to verify a sub-agent's work), but it must not EDIT them: every change
goes through a sub-agent so the work is delegated, captured in PROGRESS.md's Findings, and the
primary's context stays manageable. We cannot remove write_file/patch from the parent's toolset —
Hermes caps a child's toolset to a subset of the parent's (see delegate_tool's intersection), so
that would strip editing from sub-agents too. Instead we keep the tools and BLOCK them for the
primary only, via a pre_tool_call directive. The prompt tells the model they're disabled so it
delegates up front and rarely trips the block.

Primary vs sub-agent is decided by task_id without relying on call ordering: the first tool call in
the process is the parent's (a child only exists after a delegate_task), and any task_id seen WHILE a
delegation is in flight is a sub-agent's. The hooks never raise — a guard failure must not break a
run (it just declines to block).
"""
from __future__ import annotations

import os
import threading
from typing import Any

_WORKER_PHASES = {"IMPLEMENT", "REVISE"}
# Editing only — the primary may still read (read_file/search_files/cat) to verify a sub-agent.
_BLOCKED = {"write_file", "patch"}

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "primary": None,  # the primary agent's task_id, once known
    "active": 0,  # in-flight delegate_task calls
    "subagents": set(),  # task_ids identified as delegated sub-agents
}


def _phase_ok() -> bool:
    return (os.environ.get("OLYMPIAN_PHASE") or "").strip().upper() in _WORKER_PHASES


def on_pre_tool_call(*, tool_name: str = "", task_id: str = "", **_: Any) -> Any:
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

        if tool_name in _BLOCKED and not is_subagent:
            return {
                "action": "block",
                "message": (
                    f"`{tool_name}` is disabled for you (the orchestrator) — you must not edit files "
                    "yourself. Delegate this change to a sub-agent with delegate_task; it edits in its "
                    "own context and returns the result to you. (You can still read files directly to "
                    "verify a sub-agent's work.)"
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
