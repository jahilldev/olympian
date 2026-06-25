import { type ChatMessage } from '@prisma/client';
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
