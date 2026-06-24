"""orchestrator_toolset — a read + delegate toolset for the IMPLEMENT/REVISE parent.

To keep the parent's context small it must delegate every file edit to a subagent (which reads and
writes the file in its OWN context). But Hermes bundles ``read_file``/``search_files`` with
``write_file``/``patch`` in the ``file`` toolset and treats ``write_file``/``patch`` as core, and
``-t`` only accepts toolset names — so there's no built-in way to say "read but not write."

We register a custom ``worker_toolset`` toolset (read + search + terminal + todo + delegation,
no write/patch). The orchestrator passes ``-t worker_toolset`` for worker-phase parents, so
``write_file``/``patch`` are simply ABSENT from the parent's tool schema — it can read, search, run
tests, keep its todo, and delegate, but cannot edit directly. Children keep the full ``file`` toolset
via their own ``delegate_task`` toolsets, so they edit normally.

``enabled_toolsets`` RESTRICTS the agent to the named toolset (it doesn't merge core back in), so a
toolset that omits write/patch genuinely removes them — no blocked-tool turn, the model just never
sees them. We register at import time (the earliest point — when discover_plugins imports this) and
again in register(), so the toolset exists before ``-t`` is resolved.
"""
from __future__ import annotations

from typing import Any

_NAME = "worker_toolset"


def _register_toolset() -> None:
    try:
        from toolsets import create_custom_toolset, get_toolset

        if get_toolset(_NAME) is None:
            create_custom_toolset(
                _NAME,
                "Olympian worker-phase orchestrator: delegation + todo + terminal (tests/builds "
                "only) — NO file read or write tools; all reading and editing happens in subagents.",
                includes=["delegation", "todo", "terminal"],
            )
    except Exception:
        pass


# Earliest possible registration: runs when the plugin module is imported during discovery,
# before the agent resolves -t.
_register_toolset()


def register(ctx) -> None:  # noqa: ARG001 - ctx unused; toolset registration is import-time
    _register_toolset()  # idempotent safety net
