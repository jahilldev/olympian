"""progress plugin — append-only task progress tracker for the current job workspace.

Writes to .olympian/progress.md in the process working directory (the job's
worktree). init() overwrites on each fresh invocation so stale files from a
previous attempt never cause a false resume. done() appends, so the log
survives context compaction. read() lets the agent recover state after compaction.
"""

import json
import os
from pathlib import Path

_PROGRESS_FILE = ".olympian/progress.md"


def _path() -> Path:
    p = Path(os.getcwd()) / _PROGRESS_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def register(ctx) -> None:
    schema = {
        "name": "progress",
        "description": (
            "Append-only task progress log for the current job. "
            "Call init at session start with your full task list. "
            "Call done after each task completes. "
            "Call read after context compaction to recover current state. "
            "init always overwrites, so stale files from prior attempts are never reused."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["init", "done", "read"],
                    "description": (
                        "init: write the task list (overwrites any prior file). "
                        "done: append a completion marker for a finished task. "
                        "read: return the current progress log."
                    ),
                },
                "tasks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Full list of tasks to track. Required for action=init.",
                },
                "task": {
                    "type": "string",
                    "description": "The task that was just completed. Required for action=done.",
                },
            },
            "required": ["action"],
        },
    }

    def handler(args: dict, **_kwargs) -> str:
        action = args.get("action", "").strip()

        if action == "init":
            tasks = args.get("tasks") or []
            if not tasks:
                return json.dumps({"error": "tasks list is required for action=init"})
            lines = ["# Progress\n\n## Todo\n\n"]
            for task in tasks:
                lines.append(f"- {task}\n")
            lines.append("\n## Done\n\n")
            _path().write_text("".join(lines), encoding="utf-8")
            return json.dumps({"ok": True, "tasks": len(tasks)})

        if action == "done":
            task = args.get("task", "").strip()
            if not task:
                return json.dumps({"error": "task is required for action=done"})
            with _path().open("a", encoding="utf-8") as f:
                f.write(f"- \u2713 {task}\n")
            return json.dumps({"ok": True})

        if action == "read":
            p = _path()
            if not p.exists():
                return json.dumps({"content": "(no progress log — call init first)"})
            return json.dumps({"content": p.read_text(encoding="utf-8")})

        return json.dumps({"error": f"Unknown action '{action}'. Use: init, done, read"})

    ctx.register_tool(
        name="progress",
        toolset="progress",
        schema=schema,
        handler=handler,
    )
