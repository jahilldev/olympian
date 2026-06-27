import { type ChatMessage } from '@prisma/client';
import { type LangfuseEvent } from '../langfuse/langfuse.model.js';
import { type ChatMessageDto } from './chat.model.js';

/**
 * Normalizes a model's raw title output into a clean, short session title: takes the first
 * non-empty line and strips quotes/markdown/`Title:` prefixes and trailing punctuation, then
 * caps the length on a word boundary. Returns '' when nothing usable remains.
 */
export function cleanTitle(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) {
    return '';
  }

  let t = firstLine
    .replace(/^title:\s*/i, '')
    .replace(/^[`*_#>\s-]+/, '')
    .replace(/[`*_#]+$/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.:;,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (t.length > 80) {
    t = t
      .slice(0, 80)
      .replace(/\s+\S*$/, '')
      .trim();
  }

  return t;
}

export function toMessageDto(m: ChatMessage): ChatMessageDto {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    agentRunId: m.agentRunId,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Reconstructs persisted AgentEvent rows back into LangfuseEvents grouped by runId. The full
 *  event body was stored verbatim, so the rebuilt events render identically to the live ones. */
export function eventsByRun(
  rows: { runId: string; type: string; timestamp: string; body: string }[],
): Record<string, LangfuseEvent[]> {
  const out: Record<string, LangfuseEvent[]> = {};

  for (const r of rows) {
    (out[r.runId] ??= []).push({
      type: r.type,
      timestamp: r.timestamp,
      body: JSON.parse(r.body) as Record<string, unknown>,
    });
  }

  return out;
}
