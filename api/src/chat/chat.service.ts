import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type ChatSession } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { HermesAgentService } from '../agent/agent.service.js';
import { WorkspaceService } from '../workspace/workspace.service.js';
import { type RemoteAuth } from '../workspace/workspace.model.js';
import { LangfuseService } from '../langfuse/langfuse.service.js';
import { type LangfuseEvent } from '../langfuse/langfuse.model.js';
import {
  DEFAULT_CHAT_TITLE,
  type ChatSessionDetailDto,
  type ChatSessionSummaryDto,
} from './chat.model.js';
import { buildChatPrompt, buildTitlePrompt } from './chat.prompts.js';
import { cleanTitle, eventsByRun, toMessageDto } from './chat.utility.js';

/**
 * Owns interactive chat sessions. Reuses HermesAgentService (CHAT phase) and the Langfuse
 * SSE stream for live responses, but bypasses the job queue and the plan/verify/review loop.
 * Runs are dispatched in the background so the HTTP response returns the runId immediately;
 * a small semaphore bounds concurrency so chat doesn't starve worker jobs.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly agent: HermesAgentService,
    private readonly workspace: WorkspaceService,
    private readonly langfuse: LangfuseService,
  ) {}

  async createSession(input: { title?: string; repoUrl?: string }): Promise<{ id: string }> {
    const session = await this.prisma.chatSession.create({
      data: { title: input.title?.trim() || DEFAULT_CHAT_TITLE, repoUrl: input.repoUrl ?? null },
    });

    return { id: session.id };
  }

  async listSessions(): Promise<ChatSessionSummaryDto[]> {
    const sessions = await this.prisma.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });

    return sessions.map((s) => this.toSummary(s, s._count.messages));
  }

  /**
   * Permanently remove a session and everything it owns. The schema cascades the delete to the
   * session's messages, agent runs, and their events, so a single delete is sufficient.
   */
  async deleteSession(id: string): Promise<void> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }

    await this.prisma.chatSession.delete({ where: { id } });
  }

  async getSession(id: string): Promise<ChatSessionDetailDto> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!session) {
      throw new NotFoundException(`Chat session ${id} not found`);
    }

    const activeRun = await this.prisma.agentRun.findFirst({
      where: { sessionId: id, status: 'RUNNING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    return {
      ...this.toSummary(session, session.messages.length),
      messages: session.messages.map(toMessageDto),
      activeRunId: activeRun?.id ?? null,
    };
  }

  /**
   * Retained agent activity (event cards) per assistant turn, keyed by runId — so the UI can
   * re-render a session's history on reload. Empty for runs whose buffer has since expired.
   */
  async getActivity(sessionId: string): Promise<Record<string, LangfuseEvent[]>> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: 'assistant', agentRunId: { not: null } },
      select: { agentRunId: true },
    });

    const runIds = messages.map((m) => m.agentRunId).filter((r): r is string => !!r);

    if (runIds.length === 0) {
      return {};
    }

    // Durable source: events persisted to AgentEvent when each run completed.
    const rows = await this.prisma.agentEvent.findMany({
      where: { runId: { in: runIds } },
      orderBy: [{ runId: 'asc' }, { seq: 'asc' }],
      select: { runId: true, type: true, timestamp: true, body: true },
    });

    const out = eventsByRun(rows);

    // Fall back to the live in-memory buffer for any run not yet persisted (e.g. a run that
    // completed in this same process before its rows were written, or pre-migration sessions).
    for (const runId of runIds) {
      if (!out[runId]?.length) {
        const buffered = this.langfuse.getBuffer(runId);
        if (buffered.length > 0) {
          out[runId] = buffered;
        }
      }
    }

    return out;
  }

  /**
   * Persist the user message, then dispatch a CHAT agent run in the background. Returns the
   * runId as soon as the run row exists so the UI can open the SSE stream; the assistant
   * message is persisted from the run's output when it completes.
   */
  async sendMessage(
    sessionId: string,
    content: string,
    opts: { model?: string; provider?: string } = {},
  ): Promise<{ runId: string }> {
    const session = await this.prisma.chatSession.findUnique({ where: { id: sessionId } });

    if (!session) {
      throw new NotFoundException(`Chat session ${sessionId} not found`);
    }

    const priorCount = await this.prisma.chatMessage.count({ where: { sessionId } });

    await this.prisma.chatMessage.create({ data: { sessionId, role: 'user', content } });
    await this.touch(sessionId);

    const history = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    const ws = await this.workspace.prepare({
      jobId: sessionId,
      auth: this.authFor(session),
      branchName: `chat-${sessionId.slice(0, 8)}`,
    });

    // First message of an untitled session → auto-generate a title in the background.
    if (priorCount === 0 && session.title === DEFAULT_CHAT_TITLE) {
      void this.generateTitle(sessionId, ws.dir, content);
    }

    const prompt = buildChatPrompt({ repoUrl: session.repoUrl, history });

    const runId = await new Promise<string>((resolve, reject) => {
      void this.dispatchRun(sessionId, ws.dir, prompt, resolve, opts).catch((e: unknown) => {
        this.logger.error(`chat run dispatch failed: ${(e as Error).message}`);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });

    return { runId };
  }

  /** Runs the agent under the concurrency semaphore and persists the assistant reply. */
  private async dispatchRun(
    sessionId: string,
    cwd: string,
    prompt: string,
    onStart: (runId: string) => void,
    opts: { model?: string; provider?: string } = {},
  ): Promise<void> {
    await this.acquire();

    try {
      const res = await this.agent.run({
        sessionId,
        phase: 'CHAT',
        cwd,
        prompt,
        onStart,
        model: opts.model,
        provider: opts.provider,
      });

      const content =
        res.status === 'SUCCEEDED' && res.stdout.trim().length > 0
          ? res.stdout.trim()
          : `_(the assistant run ended ${res.status.toLowerCase()} with no output)_`;

      await this.prisma.chatMessage.create({
        data: { sessionId, role: 'assistant', content, agentRunId: res.runId },
      });

      // The run's activity events are persisted centrally by HermesAgentService.run().
      await this.touch(sessionId);
    } finally {
      this.release();
    }
  }

  /**
   * Best-effort auto-title from the first user message via a short, tool-less agent run on the
   * auxiliary model (falling back to the primary when no auxiliary is configured). Runs under the
   * concurrency semaphore and is unowned (no jobId/sessionId), so it never shows as chat activity
   * or as the session's active run. A failure or empty result leaves the default title in place.
   */
  private async generateTitle(sessionId: string, cwd: string, firstMessage: string): Promise<void> {
    await this.acquire();

    try {
      const res = await this.agent.run({
        phase: 'TITLE',
        cwd,
        prompt: buildTitlePrompt(firstMessage),
        model: this.config.get('HERMES_AUXILIARY_MODEL') || this.config.get('HERMES_PRIMARY_MODEL'),
        provider:
          this.config.get('HERMES_AUXILIARY_PROVIDER') ||
          this.config.get('HERMES_PRIMARY_PROVIDER'),
      });

      const title = res.status === 'SUCCEEDED' ? cleanTitle(res.stdout) : '';

      // Only overwrite if still the default — a user/explicit title set meanwhile wins.
      if (title.length > 0) {
        await this.prisma.chatSession.updateMany({
          where: { id: sessionId, title: DEFAULT_CHAT_TITLE },
          data: { title },
        });
      }
    } catch (e) {
      this.logger.warn(`chat title generation failed: ${(e as Error).message}`);
    } finally {
      this.release();
    }
  }

  private authFor(session: ChatSession): RemoteAuth {
    return session.repoUrl ? { kind: 'ssh', url: session.repoUrl } : { kind: 'none' };
  }

  private toSummary(s: ChatSession, messageCount: number): ChatSessionSummaryDto {
    return {
      id: s.id,
      title: s.title,
      repoUrl: s.repoUrl,
      messageCount,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private touch(sessionId: string): Promise<unknown> {
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  // ── Concurrency semaphore (shares the WORKER_CONCURRENCY budget) ─────────────

  private acquire(): Promise<void> {
    const limit = Math.max(1, this.config.get('WORKER_CONCURRENCY'));

    if (this.active < limit) {
      this.active++;

      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;

    const next = this.waiters.shift();

    if (next) {
      next();
    }
  }
}
