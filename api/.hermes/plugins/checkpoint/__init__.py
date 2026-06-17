"""checkpoint plugin — in-place task checklist for the current job workspace.

Writes to .olympian/progress.md in the process working directory (the job's
worktree). init() overwrites on each fresh invocation so stale files from a
previous attempt never cause a false resume. done(index=N) marks the Nth task
[x] by position so read() always shows a clear picture of pending vs completed.
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
        "name": "checkpoint",
        "description": (
            "Persistent task checklist for the current job session.\n\n"
            "ALWAYS pass the action as the 'action' parameter — never as a bare key.\n\n"
            "Three actions:\n"
            "  checkpoint(action='init', tasks=['Task 1', 'Task 2', ...])  — start a fresh checklist; overwrites any prior file\n"
            "  checkpoint(action='done', index=N)                          — mark the Nth task complete (1-based); call this after every completed task\n"
            "  checkpoint(action='read')                                   — read the current checklist (use after context compaction to recover your task list)\n\n"
            "Rules:\n"
            "- Call init once at the start of each session with your complete task list.\n"
            "- Call done(index=N) immediately after finishing each task — do not batch or skip.\n"
            "- Call read if context was compacted and you need to know which tasks remain."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["init", "done", "read"],
                    "description": (
                        "Which operation to perform. Must be exactly one of: 'init', 'done', 'read'. "
                        "Pass as {\"action\": \"done\", \"index\": 2} — NOT as {\"done\": 2}."
                    ),
                },
                "tasks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Required for action='init'. Full list of task descriptions to track.",
                },
                "index": {
                    "type": "integer",
                    "description": "Required for action='done'. The 1-based position of the task to mark complete.",
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
            lines = ["# Progress\n\n"]
            for task in tasks:
                lines.append(f"- [ ] {task}\n")
            _path().write_text("".join(lines), encoding="utf-8")
            return json.dumps({"ok": True, "tasks": len(tasks)})

        if action == "done":
            raw = args.get("index")
            if raw is None:
                return json.dumps({"error": "index is required for action=done (1-based)"})
            try:
                idx = int(raw)
                if idx < 1:
                    raise ValueError
            except (TypeError, ValueError):
                return json.dumps({"error": "index must be a positive integer"})
            p = _path()
            if not p.exists():
                return json.dumps({"error": "no progress log — call init first"})
            content = p.read_text(encoding="utf-8")
            lines = content.splitlines(keepends=True)
            task_num = 0
            new_lines = []
            matched = False
            for line in lines:
                if "[ ]" in line or "[x]" in line:
                    task_num += 1
                    if task_num == idx and "[ ]" in line:
                        line = line.replace("[ ]", "[x]", 1)
                        matched = True
                new_lines.append(line)
            if not matched:
                if task_num < idx:
                    return json.dumps({"error": f"index {idx} out of range (only {task_num} tasks)"})
                return json.dumps({"ok": True, "note": f"task {idx} was already done"})
            p.write_text("".join(new_lines), encoding="utf-8")
            return json.dumps({"ok": True, "index": idx})

        if action == "read":
            p = _path()
            if not p.exists():
                return json.dumps({"content": "(no progress log — call init first)"})
            return json.dumps({"content": p.read_text(encoding="utf-8")})

        return json.dumps({"error": f"Unknown action '{action}'. Use: init, done, read"})

    ctx.register_tool(
        name="checkpoint",
        toolset="checkpoint",
        schema=schema,
        handler=handler,
    )
