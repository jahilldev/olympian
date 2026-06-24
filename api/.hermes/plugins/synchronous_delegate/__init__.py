"""synchronous_delegate — make delegate_task synchronous in headless Olympian runs.

Hermes forces every top-level ``delegate_task`` to ``background=true`` (the value is computed in
``_model_background_value``, not chosen by the model), then consults ``async_delivery_supported()``
to decide whether it can actually detach. On the ``-z`` CLI that helper defaults to True (its
contextvar is unset), so the delegation detaches and its result is meant to re-enter asynchronously
— but a stateless ``-z`` run has no channel to deliver it. The consequences we hit:
  * the subagent's real result can be LOST (no delivery channel after the turn), and
  * ``persist_state`` only ever sees the dispatch acknowledgement, not the report.

The fix is the deterministic lever: force ``async_delivery_supported()`` to return False. Hermes then
falls back to SYNCHRONOUS execution — the parent blocks, the subagent's real result returns in-band
(so ``persist_state`` captures it into PROGRESS.md Findings), and nothing is lost.

``gateway.session_context`` isn't a dependable import path from a plugin and ``delegate_task``
re-imports the helper at call time, so we patch the loaded module's attribute (same approach as
``capture_reasoning``), lazily on ``pre_api_request`` so it lands before the first delegation.
Defensive throughout: a telemetry/behaviour tweak must never break a run.
"""
from __future__ import annotations

import importlib
import logging
import sys
from typing import Any

_LOG = logging.getLogger("olympian.synchronous_delegate")
_patched = False
_attempts = 0
_warned = False


def _force_false(*_a: Any, **_k: Any) -> bool:
    return False


_force_false._olympian_forced = True  # type: ignore[attr-defined]


def _ensure_patch() -> None:
    global _patched, _attempts, _warned
    if _patched:
        return
    _attempts += 1
    try:
        mod = sys.modules.get("gateway.session_context")
        if mod is None:
            try:
                mod = importlib.import_module("gateway.session_context")
            except Exception:
                mod = None
        if mod is not None and hasattr(mod, "async_delivery_supported"):
            if not getattr(mod.async_delivery_supported, "_olympian_forced", False):
                mod.async_delivery_supported = _force_false
            _patched = True
            return
    except Exception as exc:
        if not _warned:
            _warned = True
            _LOG.warning("synchronous_delegate: failed to patch async_delivery_supported: %s", exc)
        return

    if not _warned and _attempts >= 2:
        _warned = True
        _LOG.warning(
            "synchronous_delegate: gateway.session_context.async_delivery_supported not found — "
            "delegations may run detached and lose their results in headless mode. The Hermes "
            "internals likely changed; review the synchronous_delegate plugin."
        )


def on_pre_api_request(**_: Any) -> None:
    _ensure_patch()


def register(ctx) -> None:
    _ensure_patch()  # in case gateway.session_context is already imported
    ctx.register_hook("pre_api_request", on_pre_api_request)
