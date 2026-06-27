import { IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { SSH_REMOTE_REGEX } from '../orchestrator/orchestrator.model.js';

const SSH_MESSAGE = 'repoUrl must be an SSH remote (git@host:path or ssh://…)';

export type ChatRole = 'user' | 'assistant';

// --- UI read-model DTOs ---

export interface ChatMessageDto {
  id: string;
  role: string;
  content: string;
  agentRunId: string | null;
  createdAt: string;
}

export interface ChatSessionSummaryDto {
  id: string;
  title: string;
  repoUrl: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionDetailDto extends ChatSessionSummaryDto {
  messages: ChatMessageDto[];
  /** A CHAT run still in flight for this session (its assistant message isn't persisted yet),
   *  so the UI can reattach to its live SSE stream after a reload. null when idle. */
  activeRunId: string | null;
}

// --- request DTOs ---

/** Body for `POST /api/chats`. */
export class CreateChatDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @ValidateIf((o: CreateChatDto) => !!o.repoUrl)
  @Matches(SSH_REMOTE_REGEX, { message: SSH_MESSAGE })
  repoUrl?: string;
}

/** Body for `POST /api/chats/:id/messages`. */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content!: string;

  /** Optional model/provider override for this turn (from the UI's model selector). */
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;
}

/** Default title for a session created with no explicit title. */
export const DEFAULT_CHAT_TITLE = 'New chat';
