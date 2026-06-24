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

import re
import sys
from typing import Any

_patched = False
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
        try:
            if isinstance(out, dict) and not out.get("reasoning"):
                reasoning = _extract_reasoning_text(message)
                if reasoning:
                    out["reasoning"] = reasoning
        except Exception:
            pass
        return out

    wrapped._olympian_reasoning_wrap = True  # type: ignore[attr-defined]
    return wrapped


def _ensure_patch() -> None:
    """Find the loaded Langfuse plugin module and wrap its serializer (idempotent)."""
    global _patched
    if _patched:
        return
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
    except Exception:
        pass


def on_pre_api_request(**_: Any) -> None:
    _ensure_patch()


def register(ctx) -> None:
    _ensure_patch()  # in case the Langfuse module is already loaded at registration
    ctx.register_hook("pre_api_request", on_pre_api_request)
