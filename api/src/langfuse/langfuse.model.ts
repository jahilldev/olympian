export interface LangfuseEvent {
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
}

export type StreamPayload =
  | { type: 'history'; events: LangfuseEvent[] }
  | { type: 'event'; event: LangfuseEvent }
  | { type: 'done'; status: string; exitCode: number | null; durationMs: number | null }
  | { type: 'error'; message: string };

export const LANGFUSE_PUBLIC_KEY = 'pk-lf-olympian';
export const LANGFUSE_SECRET_KEY = 'sk-lf-olympian';
export const BUFFER_EVENTS = 1_000;
