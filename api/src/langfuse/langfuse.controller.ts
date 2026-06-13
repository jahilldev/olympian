import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Sse,
  UnauthorizedException,
  type MessageEvent,
} from '@nestjs/common';
import { concat, EMPTY, interval, merge, of, type Observable } from 'rxjs';
import { concatMap, filter, map, shareReplay, take, takeUntil } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service.js';
import { type LangfuseEvent, type StreamPayload } from './langfuse.model.js';
import { LangfuseService } from './langfuse.service.js';

interface IngestionBatchItem {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

@Controller()
export class LangfuseController {
  private readonly logger = new Logger(LangfuseController.name);

  constructor(
    private readonly langfuse: LangfuseService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Langfuse batch ingestion endpoint. The Langfuse Python SDK constructs the
   * full URL as {HERMES_LANGFUSE_BASE_URL}/api/public/ingestion — we set the
   * base URL to http://…/langfuse, so the full path lands here.
   */
  @Post('langfuse/api/public/ingestion')
  @HttpCode(HttpStatus.OK)
  ingest(
    @Headers('authorization') auth: string | undefined,
    @Body() body: { batch?: IngestionBatchItem[] },
  ): { successes: { id: string }[]; errors: unknown[] } {
    if (!this.langfuse.verifyCredentials(auth)) {
      throw new UnauthorizedException();
    }

    const batch = body.batch ?? [];
    const successes: { id: string }[] = [];

    for (const item of batch) {
      const sessionId =
        (item.body?.sessionId as string | undefined) ??
        (item.metadata?.sessionId as string | undefined) ??
        (item.body?.traceId as string | undefined);

      if (sessionId) {
        const ev: LangfuseEvent = { type: item.type, timestamp: item.timestamp, body: item.body };

        this.langfuse.ingest(sessionId, [ev]);
        this.logger.debug(`[${sessionId}] ingested ${item.type}`);
      }

      successes.push({ id: item.id });
    }

    return { successes, errors: [] };
  }

  /**
   * SSE stream of Langfuse trace events for a specific agent run. Emits buffered
   * history immediately, then live events as they arrive. Polls every 3 s for run
   * completion and emits a final 'done' event before closing the stream.
   */
  @Sse('stream/runs/:runId')
  async streamRun(@Param('runId') runId: string): Promise<Observable<MessageEvent>> {
    const encode = (payload: StreamPayload): MessageEvent =>
      ({ data: JSON.stringify(payload) }) as MessageEvent;

    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { status: true, exitCode: true, durationMs: true },
    });

    if (!run) {
      return of(encode({ type: 'error', message: 'Run not found' }));
    }

    if (run.status !== 'RUNNING') {
      return of(
        encode({ type: 'history', events: [] }),
        encode({
          type: 'done',
          status: run.status,
          exitCode: run.exitCode,
          durationMs: run.durationMs,
        }),
      );
    }

    const history$ = of(encode({ type: 'history', events: this.langfuse.getBuffer(runId) }));

    const live$ = (this.langfuse.observe(runId) ?? EMPTY).pipe(
      map((event) => encode({ type: 'event', event })),
    );

    // Poll every 3 s; when the run leaves RUNNING, emit 'done' and close the stream.
    // shareReplay so both takeUntil and merge share a single polling subscription.
    const done$ = interval(3_000).pipe(
      concatMap(() =>
        this.prisma.agentRun.findUnique({
          where: { id: runId },
          select: { status: true, exitCode: true, durationMs: true },
        }),
      ),
      filter((r): r is NonNullable<typeof r> => !!r && r.status !== 'RUNNING'),
      take(1),
      map((r) =>
        encode({ type: 'done', status: r.status, exitCode: r.exitCode, durationMs: r.durationMs }),
      ),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return concat(history$, merge(live$.pipe(takeUntil(done$)), done$));
  }
}
