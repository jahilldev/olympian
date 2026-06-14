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

/** Render a single LLM/tool event as a terminal-style card. */
function EventCard({ event }: { event: LangfuseEvent }) {
  const body = event.body;
  const obsType = body['langfuse.observation.type'] as string | undefined;
  const name = (body['langfuse.observation.name'] ?? body.name ?? '') as string;

  if (obsType === 'generation') {
    const input = body['langfuse.prompt'] ?? body.input;
    const output = body['langfuse.completion'] ?? body.output;
    const model = body['langfuse.model'] ?? body.model;
    const tokens = body['langfuse.usage.total_tokens'] ?? body['usage.total_tokens'];

    return (
      <div class="border-l-2 border-indigo-700 pl-3 py-1 space-y-1">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-indigo-400 font-mono font-medium">LLM</span>
          {model && <span class="text-zinc-500">{String(model)}</span>}
          {tokens != null && <span class="text-zinc-600 ml-auto">{String(tokens)} tok</span>}
        </div>
        {input != null && (
          <pre class="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-4 font-mono">
            {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
          </pre>
        )}
        {output != null && (
          <pre class="text-xs text-zinc-200 whitespace-pre-wrap font-mono">
            {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (obsType === 'tool') {
    const input = body['langfuse.input'] ?? body.input;
    return (
      <div class="border-l-2 border-amber-700 pl-3 py-1 space-y-1">
        <div class="flex items-center gap-2 text-xs">
          <span class="text-amber-400 font-mono font-medium">TOOL</span>
          <span class="text-zinc-300 font-mono">{name}</span>
        </div>
        {input != null && (
          <pre class="text-xs text-zinc-500 whitespace-pre-wrap font-mono line-clamp-3">
            {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div class="border-l-2 border-zinc-700 pl-3 py-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-zinc-500 font-mono">{event.type}</span>
        {name && <span class="text-zinc-400">{name}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static output view (completed runs)
// ---------------------------------------------------------------------------

function StaticOutput({ jobId, runId, meta }: { jobId: string; runId: string; meta: RunMeta | null }) {
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
        {error && (
          <p class="text-red-400 text-xs font-mono">Failed to load output.</p>
        )}
        {!output && !error && (
          <p class="text-zinc-700 text-xs font-mono italic">Loading…</p>
        )}
        {output && (
          <pre class="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
            {stripAnsi(output.stdout) || <span class="text-zinc-700 italic">No output recorded.</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live streaming view (in-flight runs)
// ---------------------------------------------------------------------------

function StreamingOutput({ jobId, runId, meta, onMetaUpdate }: {
  jobId: string;
  runId: string;
  meta: RunMeta | null;
  onMetaUpdate: (m: RunMeta) => void;
}) {
  const [events, setEvents] = useState<LangfuseEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'done' | 'error'>('connecting');
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
          {events.map((ev, i) => (
            <EventCard key={i} event={ev} />
          ))}
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

  return (
    <StreamingOutput
      jobId={jobId}
      runId={runId}
      meta={meta}
      onMetaUpdate={setMeta}
    />
  );
}
