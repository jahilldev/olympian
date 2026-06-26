import { type ChatMessage } from '@prisma/client';
import { type LangfuseEvent } from '../langfuse/langfuse.model.js';
import { type ChatMessageDto } from './chat.model.js';

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
