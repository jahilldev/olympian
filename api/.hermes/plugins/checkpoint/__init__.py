"""checkpoint plugin — in-place task checklist for the current job workspace.

Writes to .olympian/progress.md in the process working directory (the job's
worktree). init() starts a fresh checklist; if tasks are already in progress it
refuses unless force=True is passed. done(index=N) marks the Nth task [x] and
optionally stores notes below the task line. skip(index=N, notes=...) marks a
task [~] with a mandatory reason. read() returns the file content plus a parsed
summary so the agent can immediately see which tasks remain after compression.
"""

import json
import os
from pathlib import Path

_PROGRESS_FILE = ".olympian/progress.md"


def _path() -> Path:
    p = Path(os.getcwd()) / _PROGRESS_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _is_task_line(line: str) -> bool:
    return "[ ]" in line or "[x]" in line or "[~]" in line


def _parse(content: str) -> dict:
    """Return structured summary of a progress file."""
    completed: list[int] = []
    pending: list[int] = []
    skipped: list[int] = []
    task_num = 0
    for line in content.splitlines():
        if not _is_task_line(line):
            continue
        task_num += 1
        if "[x]" in line:
            completed.append(task_num)
        elif "[~]" in line:
            skipped.append(task_num)
        else:
            pending.append(task_num)
    return {
        "total": task_num,
        "completed": completed,
        "pending": pending,
        "skipped": skipped,
    }


def _mark_task(args: dict, marker: str, require_notes: bool) -> str:
    """Shared logic for done and skip actions."""
    raw = args.get("index")
    if raw is None:
        return json.dumps({"error": f"index is required for action={args.get('action')} (1-based)"})
    try:
        idx = int(raw)
        if idx < 1:
            raise ValueError
    except (TypeError, ValueError):
        return json.dumps({"error": "index must be a positive integer"})

    notes = (args.get("notes") or "").strip()
    if require_notes and not notes:
        return json.dumps({"error": "notes is required for action=skip — explain why the task was skipped"})

    p = _path()
    if not p.exists():
        return json.dumps({"error": "no progress log — call init first"})

    content = p.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)
    task_num = 0
    new_lines = []
    matched = False

    for line in lines:
        if _is_task_line(line):
            task_num += 1
            if task_num == idx and "[ ]" in line:
                line = line.replace("[ ]", f"[{marker}]", 1)
                if not line.endswith("\n"):
                    line += "\n"
                if notes:
                    line += f"  - {notes}\n"
                matched = True
        new_lines.append(line)

    if not matched:
        if task_num < idx:
            return json.dumps({"error": f"index {idx} out of range (only {task_num} tasks)"})
        return json.dumps({"ok": True, "note": f"task {idx} was already done or skipped"})

    p.write_text("".join(new_lines), encoding="utf-8")
    return json.dumps({"ok": True, "index": idx})


def register(ctx) -> None:
    schema = {
        "name": "checkpoint",
        "description": (
            "Persistent task checklist for the current job session. Survives context compaction.\n\n"
            "ALWAYS pass the action as the 'action' parameter — never as a bare key.\n\n"
            "Actions:\n"
            "  checkpoint(action='init', tasks=['Task 1', ...])                 — start a fresh checklist; "
            "refused if tasks are already in progress (use force=True only for a genuine restart)\n"
            "  checkpoint(action='done', index=N)                               — mark the Nth task complete (1-based)\n"
            "  checkpoint(action='done', index=N, notes='what was done / caveats') — mark complete with context for future reads\n"
            "  checkpoint(action='skip', index=N, notes='reason')               — mark the Nth task skipped; notes required\n"
            "  checkpoint(action='read')                                        — returns file content AND a parsed summary "
            "{total, completed:[...], pending:[...], skipped:[...]} so you can see what remains at a glance\n\n"
            "Rules:\n"
            "- Call init once at the very start of each session with your complete task list.\n"
            "- If you are resuming after context compaction, call read — do NOT call init again.\n"
            "- Call done(index=N) immediately after each task — do not batch or defer.\n"
            "- Include notes on done when the implementation involved non-obvious decisions or caveats.\n"
            "- Call skip(index=N, notes='reason') for tasks that became irrelevant; never leave them as [ ].\n"
            "- Anti-pattern: {\"done\": 2} — correct form: {\"action\": \"done\", \"index\": 2}"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["init", "done", "skip", "read"],
                    "description": (
                        "Which operation to perform. One of: 'init', 'done', 'skip', 'read'. "
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
                    "description": "Required for action='done' and 'skip'. 1-based position of the task.",
                },
                "notes": {
                    "type": "string",
                    "description": (
                        "For action='done': optional context — what was done, any caveats, or non-obvious decisions. "
                        "For action='skip': required — reason the task was skipped or superseded."
                    ),
                },
                "force": {
                    "type": "boolean",
                    "description": (
                        "For action='init' only. Set true to overwrite an existing in-progress checklist. "
                        "Only use this for a genuine new attempt, never after context compaction."
                    ),
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
            force = bool(args.get("force", False))
            p = _path()
            if p.exists() and not force:
                content = p.read_text(encoding="utf-8")
                summary = _parse(content)
                if summary["completed"] or summary["skipped"]:
                    return json.dumps({
                        "error": (
                            "A checklist with completed or skipped tasks already exists — "
                            "call read to resume, or pass force=true to reset."
                        ),
                        "existing": content,
                        "summary": summary,
                    })
            lines = ["# Progress\n\n"]
            for task in tasks:
                lines.append(f"- [ ] {task}\n")
            _path().write_text("".join(lines), encoding="utf-8")
            return json.dumps({"ok": True, "tasks": len(tasks)})

        if action == "done":
            return _mark_task({**args, "action": "done"}, "x", require_notes=False)

        if action == "skip":
            return _mark_task({**args, "action": "skip"}, "~", require_notes=True)

        if action == "read":
            p = _path()
            if not p.exists():
                return json.dumps({"content": "(no progress log — call init first)"})
            content = p.read_text(encoding="utf-8")
            return json.dumps({"content": content, "summary": _parse(content)})

        return json.dumps({"error": f"Unknown action '{action}'. Use: init, done, skip, read"})

    ctx.register_tool(
        name="checkpoint",
        toolset="checkpoint",
        schema=schema,
        handler=handler,
    )
