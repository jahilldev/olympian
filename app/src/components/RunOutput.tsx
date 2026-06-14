import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { LangfuseEvent, StreamPayload } from '@olympian/api/langfuse/langfuse.model.js';
import type { AgentRunOutputDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from '../utils/navigate.ts';

interface RunMeta {
  phase: string;
  model: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
}

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT']);

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function statusDot(status: string) {
  if (status === 'RUNNING')
    return <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />;
  if (status === 'SUCCEEDED') return <span class="text-green-400 text-sm">✓</span>;
  if (status === 'FAILED') return <span class="text-red-400 text-sm">✗</span>;
  return <span class="text-zinc-500 text-sm">—</span>;
}

/** Strip ANSI escape codes so raw terminal output renders cleanly. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

// ── Icons ─────────────────────────────────────────────────────────────────

function IconBrain() {
  return (
    <svg
      class="w-3.5 h-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.96-3 2.5 2.5 0 0 1-1.32-4.24 3 3 0 0 1 .34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.96-3 2.5 2.5 0 0 0 1.32-4.24 3 3 0 0 0-.34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2" />
    </svg>
  );
}

function IconWrench() {
  return (
    <svg
      class="w-3.5 h-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      class={`w-3 h-3 shrink-0 transition-transform duration-150${open ? ' rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

/** Peel <think>…</think> off the front of a model completion. */
function splitThinking(text: string): { thinking: string | null; output: string } {
  const m = text.match(/^<think>([\s\S]*?)<\/think>\s*/);
  if (!m) return { thinking: null, output: text.trim() };
  return { thinking: m[1].trim(), output: text.slice(m[0].length).trim() };
}

// ── Event sub-cards ────────────────────────────────────────────────────────

function GenerationCard({ event }: { event: LangfuseEvent }) {
  const [thinkOpen, setThinkOpen] = useState(false);
  const body = event.body;
  const model = body['langfuse.model'] ?? body.model;
  const tokens = body['langfuse.usage.total_tokens'] ?? body['usage.total_tokens'];
  const rawOutput = body['langfuse.completion'] ?? body.output;
  const { thinking, output } =
    rawOutput != null ? splitThinking(toStr(rawOutput)) : { thinking: null, output: '' };

  return (
    <div class="rounded-md border border-indigo-900/60 overflow-hidden text-xs">
      <div class="flex items-center gap-2 px-3 py-2 bg-indigo-950/40 text-indigo-300">
        <IconBrain />
        <span class="font-semibold font-mono tracking-wide">LLM</span>
        {model != null && (
          <span class="text-zinc-500 font-mono font-normal truncate max-w-xs">{String(model)}</span>
        )}
        {tokens != null && (
          <span class="ml-auto text-zinc-600 font-mono text-[11px] tabular-nums">
            {String(tokens)} tok
          </span>
        )}
      </div>

      {thinking && (
        <>
          <button
            class="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono text-zinc-600 hover:text-zinc-400 border-t border-indigo-900/40 bg-zinc-950/40 transition-colors text-left"
            onClick={() => setThinkOpen((o) => !o)}
          >
            <IconChevron open={thinkOpen} />
            <span class="text-indigo-900">✦</span>
            <span>Thinking</span>
            <span class="text-zinc-700 ml-1">· {thinking.split('\n').length} lines</span>
          </button>
          {thinkOpen && (
            <div class="border-t border-zinc-800/60 px-3 py-2.5 bg-zinc-950/70">
              <pre class="text-[11px] text-zinc-600 font-mono whitespace-pre-wrap leading-relaxed">
                {thinking}
              </pre>
            </div>
          )}
        </>
      )}

      {output && (
        <div class="border-t border-indigo-900/40 px-3 py-2.5 bg-black/10">
          <pre class="text-xs text-zinc-200 font-mono whitespace-pre-wrap leading-relaxed">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCard({ event }: { event: LangfuseEvent }) {
  const [inputOpen, setInputOpen] = useState(false);
  const body = event.body;
  const name = String(body['langfuse.observation.name'] ?? body.name ?? 'unknown');
  const raw = body['langfuse.input'] ?? body.input;
  const inputStr = raw != null ? toStr(raw) : null;

  return (
    <div class="rounded-md border border-amber-900/50 overflow-hidden text-xs">
      <div class="flex items-center gap-2 px-3 py-2 bg-amber-950/30 text-amber-300">
        <IconWrench />
        <span class="font-semibold font-mono tracking-wide">TOOL</span>
        <span class="text-zinc-200 font-mono font-normal">{name}</span>
      </div>

      {inputStr && (
        <>
          <button
            class="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono text-zinc-600 hover:text-zinc-400 border-t border-amber-900/30 bg-zinc-950/40 transition-colors text-left"
            onClick={() => setInputOpen((o) => !o)}
          >
            <IconChevron open={inputOpen} />
            <span>Input</span>
          </button>
          {inputOpen && (
            <div class="border-t border-zinc-800/60 px-3 py-2.5 bg-zinc-950/70">
              <pre class="text-[11px] text-zinc-500 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {inputStr}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GenericSpanCard({ event }: { event: LangfuseEvent }) {
  const name = String(event.body['langfuse.observation.name'] ?? event.body.name ?? '');
  return (
    <div class="flex items-center gap-2 px-3 py-1 text-[11px] font-mono text-zinc-700 border-l border-zinc-800">
      <span class="w-1 h-1 rounded-full bg-zinc-700 shrink-0" />
      <span>{event.type}</span>
      {name && <span class="text-zinc-600">{name}</span>}
    </div>
  );
}

function EventCard({ event }: { event: LangfuseEvent }) {
  const obsType = event.body['langfuse.observation.type'] as string | undefined;
  if (obsType === 'generation') return <GenerationCard event={event} />;
  if (obsType === 'tool') return <ToolCard event={event} />;
  return <GenericSpanCard event={event} />;
}

// ---------------------------------------------------------------------------
// Static output view (completed runs)
// ---------------------------------------------------------------------------

function StaticOutput({
  jobId,
  runId,
  meta,
}: {
  jobId: string;
  runId: string;
  meta: RunMeta | null;
}) {
  const [output, setOutput] = useState<AgentRunOutputDto | null>(null);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/runs/${runId}/output`)
      .then((r) => (r.ok ? (r.json() as Promise<AgentRunOutputDto>) : Promise.reject(r.status)))
      .then(setOutput)
      .catch(() => setError(true));
  }, [runId]);

  const copy = useCallback(() => {
    if (output) void navigator.clipboard.writeText(output.stdout);
  }, [output]);

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          ← Job detail
        </button>
        <span class="text-zinc-700">/</span>
        {meta && (
          <>
            <span class="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
              {meta.phase}
            </span>
            {meta.model && <span class="text-xs text-zinc-500 truncate">{meta.model}</span>}
            <span class="flex items-center gap-1.5">{statusDot(meta.status)}</span>
            {meta.durationMs !== null && (
              <span class="text-xs text-zinc-500">{formatDuration(meta.durationMs)}</span>
            )}
          </>
        )}
        {output && (
          <button
            class="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={copy}
          >
            Copy
          </button>
        )}
      </header>

      <div ref={scrollRef} class="flex-1 overflow-y-auto bg-black px-5 py-4">
        {error && <p class="text-red-400 text-xs font-mono">Failed to load output.</p>}
        {!output && !error && <p class="text-zinc-700 text-xs font-mono italic">Loading…</p>}
        {output && (
          <pre class="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
            {stripAnsi(output.stdout) || (
              <span class="text-zinc-700 italic">No output recorded.</span>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live streaming view (in-flight runs)
// ---------------------------------------------------------------------------

function StreamingOutput({
  jobId,
  runId,
  meta,
  onMetaUpdate,
}: {
  jobId: string;
  runId: string;
  meta: RunMeta | null;
  onMetaUpdate: (m: RunMeta) => void;
}) {
  const [events, setEvents] = useState<LangfuseEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'done' | 'error'>(
    'connecting',
  );
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/stream/runs/${runId}`);

    es.onmessage = (e) => {
      const payload = JSON.parse(e.data as string) as StreamPayload;

      if (payload.type === 'history') {
        setEvents(payload.events);
        setStreamStatus('live');
      } else if (payload.type === 'event') {
        setEvents((prev) => [...prev, payload.event]);
      } else if (payload.type === 'done') {
        onMetaUpdate({
          phase: meta?.phase ?? '',
          model: meta?.model ?? null,
          status: payload.status,
          exitCode: payload.exitCode,
          durationMs: payload.durationMs,
        });
        setStreamStatus('done');
        es.close();
      } else if (payload.type === 'error') {
        setStreamStatus('error');
        es.close();
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreamStatus((s) => (s === 'live' ? 'done' : s));
      }
    };

    return () => es.close();
  }, [runId]);

  useEffect(() => {
    if (!pinnedToBottom || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, pinnedToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinnedToBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 50);
  }, []);

  const copy = useCallback(() => {
    const text = events
      .map((e) => `[${e.timestamp}] ${e.type}\n${JSON.stringify(e.body, null, 2)}`)
      .join('\n\n');
    void navigator.clipboard.writeText(text);
  }, [events]);

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          ← Job detail
        </button>
        <span class="text-zinc-700">/</span>
        {meta && (
          <>
            <span class="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
              {meta.phase}
            </span>
            {meta.model && <span class="text-xs text-zinc-500 truncate">{meta.model}</span>}
            <span class="flex items-center gap-1.5">{statusDot(meta.status)}</span>
            {meta.durationMs !== null && (
              <span class="text-xs text-zinc-500">{formatDuration(meta.durationMs)}</span>
            )}
          </>
        )}
        {streamStatus === 'connecting' && (
          <span class="text-xs text-zinc-600 italic">connecting…</span>
        )}
        <button
          class="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={copy}
        >
          Copy
        </button>
      </header>

      <div class="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          class="h-full overflow-y-auto bg-black px-5 py-4 space-y-3 font-mono text-sm"
        >
          {events.length === 0 && streamStatus === 'live' && (
            <p class="text-zinc-700 italic text-xs">Waiting for agent activity…</p>
          )}
          {events.map((ev, i) => {
            const obsType = ev.body['langfuse.observation.type'] as string | undefined;
            const prevType =
              i > 0
                ? (events[i - 1].body['langfuse.observation.type'] as string | undefined)
                : undefined;
            const showDivider =
              obsType === 'generation' && prevType != null && prevType !== 'generation';
            return (
              <div key={i}>
                {showDivider && <hr class="border-zinc-800/60 my-1" />}
                <EventCard event={ev} />
              </div>
            );
          })}
          {streamStatus === 'done' && (
            <p class="text-zinc-600 text-xs pt-2 border-t border-zinc-900">Stream ended.</p>
          )}
          {streamStatus === 'error' && (
            <p class="text-red-500 text-xs pt-2">Stream error — run may not exist.</p>
          )}
        </div>
        {!pinnedToBottom && (
          <button
            class="absolute bottom-4 right-4 text-xs bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-full hover:bg-zinc-700 transition-colors"
            onClick={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                setPinnedToBottom(true);
              }
            }}
          >
            ↓ Latest
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component — fetches metadata and picks the right view
// ---------------------------------------------------------------------------

export default function RunOutput() {
  const parts = window.location.pathname.split('/');
  const jobId = parts[2] ?? '';
  const runId = parts[4] ?? '';

  const [meta, setMeta] = useState<RunMeta | null>(null);

  useEffect(() => {
    async function fetchMeta() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/runs`);
        if (!res.ok) return;
        const runs = (await res.json()) as {
          id: string;
          phase: string;
          model: string | null;
          status: string;
          exitCode: number | null;
          durationMs: number | null;
        }[];
        const run = runs.find((r) => r.id === runId);
        if (run) {
          setMeta({
            phase: run.phase,
            model: run.model,
            status: run.status,
            exitCode: run.exitCode,
            durationMs: run.durationMs,
          });
        }
      } catch {
        // non-fatal; meta is decorative
      }
    }
    void fetchMeta();
  }, [jobId, runId]);

  // Show a loading shimmer until we know the status. Once we know it's not
  // RUNNING we render StaticOutput; otherwise StreamingOutput takes over.
  if (!meta) {
    return (
      <div class="flex flex-col h-full overflow-hidden">
        <header class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
          <button
            class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => navigate(`/jobs/${jobId}`)}
          >
            ← Job detail
          </button>
        </header>
        <div class="flex-1 bg-black flex items-center justify-center">
          <div class="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (TERMINAL_STATUSES.has(meta.status)) {
    return <StaticOutput jobId={jobId} runId={runId} meta={meta} />;
  }

  return <StreamingOutput jobId={jobId} runId={runId} meta={meta} onMetaUpdate={setMeta} />;
}
