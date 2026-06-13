import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import {
  BUFFER_EVENTS,
  LANGFUSE_PUBLIC_KEY,
  LANGFUSE_SECRET_KEY,
  type LangfuseEvent,
} from './langfuse.model.js';

@Injectable()
export class LangfuseService {
  private readonly subjects = new Map<string, Subject<LangfuseEvent>>();
  private readonly buffers = new Map<string, LangfuseEvent[]>();
  private readonly lastEventAt = new Map<string, number>();

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
      this.buffers.set(sessionId, []);
    }

    const subject = this.subjects.get(sessionId)!;
    const buffer = this.buffers.get(sessionId)!;

    // Track the last event timestamp for idle detection
    this.lastEventAt.set(sessionId, Date.now());

    for (const ev of events) {
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
    this.buffers.delete(sessionId);
    this.lastEventAt.delete(sessionId);
  }

  observe(sessionId: string): Observable<LangfuseEvent> | null {
    return this.subjects.get(sessionId)?.asObservable() ?? null;
  }

  getBuffer(sessionId: string): LangfuseEvent[] {
    return this.buffers.get(sessionId) ?? [];
  }

  isActive(sessionId: string): boolean {
    return this.subjects.has(sessionId);
  }

  /**
   * Returns session IDs that haven't sent telemetry events in at least `idleMs`.
   * Used by the worker to detect and kill hung agents.
   */
  findIdleSessions(idleMs: number): string[] {
    const now = Date.now();
    const idle: string[] = [];

    for (const [sessionId, lastEvent] of this.lastEventAt) {
      if (now - lastEvent >= idleMs) {
        idle.push(sessionId);
      }
    }

    return idle;
  }
}
