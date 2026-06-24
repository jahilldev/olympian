"""capture_reasoning — surface the agent's thinking in the live stream.

Hermes' built-in Langfuse plugin serializes only ``message.reasoning`` into a generation span's
output, but reasoning models return their thinking as ``reasoning_content`` (or
``model_extra.reasoning_content``), and inline ``<think>`` is stripped from content before storage.
The result: the generation span we ingest has ``output.reasoning = null`` and the UI's Thinking
section never renders.

This plugin wraps the Langfuse plugin's ``_serialize_assistant_message`` to backfill
``output.reasoning`` from those fields. The UI already reads ``output.reasoning``, so the thinking
then flows through the existing OTLP → SSE → UI pipeline unchanged.

Why a monkeypatch: ``plugins/observability/`` is not an importable package (Hermes loads plugins
under synthetic module names), so we locate the Langfuse module via ``sys.modules`` and wrap it.
The patch is applied lazily on ``pre_api_request`` — by then every plugin module is loaded, and it
runs before the first response is serialized (which happens at ``post_api_request``). Everything is
wrapped in try/except: a telemetry tweak must never break a run.
"""
from __future__ import annotations

import logging
import re
import sys
from typing import Any

_LOG = logging.getLogger("olympian.capture_reasoning")
_SENTINEL = "⚠️ Unavailable: the capture_reasoning plugin failed to extract reasoning — please review."

_patched = False
_attempts = 0
_warned_missing = False
_warned_wrap_error = False
_THINK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL)


def _extract_reasoning_text(message: Any) -> str | None:
    """Pull reasoning text from an assistant message, however the provider exposes it."""
    candidate = getattr(message, "reasoning_content", None)

    if not candidate:
        model_extra = getattr(message, "model_extra", None)
        if isinstance(model_extra, dict):
            candidate = model_extra.get("reasoning_content") or model_extra.get("reasoning")

    if not candidate:
        candidate = getattr(message, "reasoning", None)

    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()

    # Inline <think>…</think> fallback (some models embed thinking in the raw content).
    content = getattr(message, "content", None)
    if isinstance(content, str) and "<think>" in content:
        combined = "\n\n".join(b.strip() for b in _THINK_RE.findall(content) if b.strip())
        if combined:
            return combined

    return None


def _wrap(orig: Any) -> Any:
    def wrapped(message: Any) -> Any:
        out = orig(message)
        if not isinstance(out, dict) or out.get("reasoning"):
            return out
        try:
            reasoning = _extract_reasoning_text(message)
            if reasoning:
                out["reasoning"] = reasoning
        except Exception as exc:
            # Don't fail silently: surface it in the UI (the Thinking section shows the sentinel)
            # AND the logs, so a future Hermes change that breaks extraction is visible rather than
            # just a missing section. A real "no reasoning this turn" returns None (no sentinel).
            global _warned_wrap_error
            out["reasoning"] = f"{_SENTINEL} ({type(exc).__name__}: {exc})"
            if not _warned_wrap_error:
                _warned_wrap_error = True
                _LOG.warning("capture_reasoning: reasoning extraction failed: %s", exc, exc_info=True)
        return out

    wrapped._olympian_reasoning_wrap = True  # type: ignore[attr-defined]
    return wrapped


def _ensure_patch() -> None:
    """Find the loaded Langfuse plugin module and wrap its serializer (idempotent)."""
    global _patched, _attempts, _warned_missing
    if _patched:
        return
    _attempts += 1
    try:
        for mod in list(sys.modules.values()):
            if mod is None:
                continue
            fn = getattr(mod, "_serialize_assistant_message", None)
            # Discriminate the Langfuse plugin specifically (it owns _get_langfuse).
            if fn is None or getattr(mod, "_get_langfuse", None) is None:
                continue
            if not getattr(fn, "_olympian_reasoning_wrap", False):
                mod._serialize_assistant_message = _wrap(fn)
            _patched = True
            return
    except Exception as exc:
        if not _warned_missing:
            _warned_missing = True
            _LOG.warning("capture_reasoning: error while patching the Langfuse serializer: %s", exc)
        return

    # Scanned everything and never found the Langfuse serializer. All plugins load well before the
    # first API request, so after a couple of misses treat it as a real break and warn loudly, once.
    if not _warned_missing and _attempts >= 2:
        _warned_missing = True
        _LOG.warning(
            "capture_reasoning: could not locate the Langfuse serializer "
            "(_serialize_assistant_message + _get_langfuse) to patch — agent reasoning will NOT be "
            "captured in the live stream. The Hermes Langfuse plugin internals likely changed; "
            "review the capture_reasoning plugin."
        )


def on_pre_api_request(**_: Any) -> None:
    _ensure_patch()


def register(ctx) -> None:
    _ensure_patch()  # in case the Langfuse module is already loaded at registration
    ctx.register_hook("pre_api_request", on_pre_api_request)
