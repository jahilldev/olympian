"""worker_guard — force the IMPLEMENT/REVISE primary to delegate by blocking its file tools.

We cannot simply remove read/write from the parent's toolset: Hermes caps a child's toolset to a
subset of the parent's (see delegate_tool's intersection), so removing those tools from the parent
strips them from sub-agents too — which blinds the whole tree. Instead we keep full tools for
everyone and BLOCK read_file/search_files/write_file/patch for the PRIMARY agent only, via a
pre_tool_call block directive. Sub-agents (depth > 0) are unaffected and read/edit normally.

The prompt tells the model these tools are blocked so it delegates from the start and rarely trips
the block — the block is the deterministic safety net, not the primary mechanism.

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
_BLOCKED = {"read_file", "search_files", "write_file", "patch"}

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

            if tool_name in _BLOCKED and task_id not in _STATE["subagents"]:
                return {
                    "action": "block",
                    "message": (
                        f"`{tool_name}` is disabled for you (the orchestrator). Do NOT read or edit "
                        "files yourself — delegate this to a sub-agent with delegate_task; it reads "
                        "and edits in its own context and returns the result to you in-band. Re-issue "
                        "this as a delegate_task instead."
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
