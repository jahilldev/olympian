import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import { AppConfigService } from '../config/config.service.js';
import {
  BUFFER_EVENTS,
  BUFFER_RETENTION_MS,
  LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY,
  type LangfuseEvent,
} from './langfuse.model.js';

@Injectable()
export class LangfuseService implements OnModuleDestroy {
  private readonly logger = new Logger(LangfuseService.name);
  private readonly subjects = new Map<string, Subject<LangfuseEvent>>();
  private readonly buffers = new Map<string, LangfuseEvent[]>();
  // When a run completed; its buffer is kept until BUFFER_RETENTION_MS elapses so the UI can
  // still render the activity on reload. Live (not-yet-completed) runs are absent here.
  private readonly retiredAt = new Map<string, number>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly config: AppConfigService) {
    // Periodically drop expired completed-run buffers. unref so it never holds the process open.
    this.sweepTimer = setInterval(() => this.sweepExpired(), 10 * 60 * 1_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  private sweepExpired(): void {
    const cutoff = Date.now() - BUFFER_RETENTION_MS;

    for (const [sessionId, at] of this.retiredAt) {
      if (at < cutoff) {
        this.buffers.delete(sessionId);
        this.retiredAt.delete(sessionId);
      }
    }
  }

  /**
   * Diagnostic: emit a compact identity line per span so the exact shape of
   * auxiliary/compression events can be inspected against a real run. Enable with
   * LANGFUSE_DEBUG_SPANS=true. Logs name, observation type, model, token usage, and
   * the full attribute-key list — enough to pin down how Hermes traces compression.
   */
  private debugLogSpan(sessionId: string, ev: LangfuseEvent): void {
    if (!this.config.get('LANGFUSE_DEBUG_SPANS')) {
      return;
    }

    const body = ev.body;
    const name = body['langfuse.observation.name'] ?? body.name ?? '';
    const obsType = body['langfuse.observation.type'] ?? '(none)';
    const model = body['langfuse.observation.model.name'] ?? '';
    const usage = body['langfuse.observation.usage_details'] ?? '';
    const keys = Object.keys(body)
      .filter((k) => !['traceId', 'spanId', 'parentSpanId', 'startTime', 'endTime'].includes(k))
      .join(',');

    this.logger.log(
      `[span ${sessionId.slice(0, 8)}] type=${String(obsType)} name=${JSON.stringify(name)} model=${String(model)} usage=${String(usage)} keys=[${keys}]`,
    );
  }

  verifyCredentials(authHeader: string | undefined): boolean {
    if (!authHeader?.startsWith('Basic ')) {
      return false;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIdx = decoded.indexOf(':');

    if (colonIdx === -1) {
      return false;
    }

    const pub = decoded.slice(0, colonIdx);
    const sec = decoded.slice(colonIdx + 1);

    return pub === LANGFUSE_PUBLIC_KEY && sec === LANGFUSE_SECRET_KEY;
  }

  ingest(sessionId: string, events: LangfuseEvent[]): void {
    if (!this.subjects.has(sessionId)) {
      this.subjects.set(sessionId, new Subject<LangfuseEvent>());
    }

    // Preserve an existing buffer (e.g. late spans arriving after complete) rather than resetting.
    if (!this.buffers.has(sessionId)) {
      this.buffers.set(sessionId, []);
    }

    // Spans are arriving again — this run is active, so it's no longer eligible for eviction.
    this.retiredAt.delete(sessionId);

    const subject = this.subjects.get(sessionId)!;
    const buffer = this.buffers.get(sessionId)!;

    for (const ev of events) {
      this.debugLogSpan(sessionId, ev);

      if (buffer.length >= BUFFER_EVENTS) {
        buffer.shift();
      }

      buffer.push(ev);
      subject.next(ev);
    }
  }

  complete(sessionId: string): void {
    this.subjects.get(sessionId)?.complete();
    this.subjects.delete(sessionId);

    // Keep the buffer (the subject is gone, so the live stream ends) so the activity can still
    // be fetched/rendered after completion; sweepExpired() drops it after BUFFER_RETENTION_MS.
    this.retiredAt.set(sessionId, Date.now());
  }

  observe(sessionId: string): Observable<LangfuseEvent> {
    if (!this.subjects.has(sessionId)) {
      this.subjects.set(sessionId, new Subject<LangfuseEvent>());
      this.buffers.set(sessionId, []);
    }

    return this.subjects.get(sessionId)!.asObservable();
  }

  getBuffer(sessionId: string): LangfuseEvent[] {
    return this.buffers.get(sessionId) ?? [];
  }

  isActive(sessionId: string): boolean {
    return this.subjects.has(sessionId);
  }
}
