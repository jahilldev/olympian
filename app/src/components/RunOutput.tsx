import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { LangfuseEvent, StreamPayload } from '@olympian/api/langfuse/langfuse.model.js';
import { navigate } from './App.tsx';

interface Props {
  jobId: string;
  runId: string;
}

interface RunMeta {
  phase: string;
  model: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
}

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

  // Generic span
  return (
    <div class="border-l-2 border-zinc-700 pl-3 py-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-zinc-500 font-mono">{event.type}</span>
        {name && <span class="text-zinc-400">{name}</span>}
      </div>
    </div>
  );
}

export default function RunOutput({ jobId, runId }: Props) {
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [events, setEvents] = useState<LangfuseEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'done' | 'error'>(
    'connecting',
  );
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch run metadata from /jobs/:jobId/runs
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
        // non-fatal — header stays blank until SSE done event fills it
      }
    }
    void fetchMeta();
  }, [jobId, runId]);

  // SSE stream
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
        setMeta((prev) =>
          prev
            ? {
                ...prev,
                status: payload.status,
                exitCode: payload.exitCode,
                durationMs: payload.durationMs,
              }
            : {
                phase: '',
                model: null,
                status: payload.status,
                exitCode: payload.exitCode,
                durationMs: payload.durationMs,
              },
        );
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

  // Auto-scroll
  useEffect(() => {
    if (!pinnedToBottom || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, pinnedToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinnedToBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 50);
  }, []);

  const copyToClipboard = useCallback(() => {
    const text = events
      .map((e) => `[${e.timestamp}] ${e.type}\n${JSON.stringify(e.body, null, 2)}`)
      .join('\n\n');
    void navigator.clipboard.writeText(text);
  }, [events]);

  return (
    <div class="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header class="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 shrink-0">
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
            {meta.model && <span class="text-xs text-zinc-500">{meta.model}</span>}
            <span class="flex items-center gap-1.5 ml-1">{statusDot(meta.status)}</span>
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
          onClick={copyToClipboard}
          title="Copy output"
        >
          Copy
        </button>
      </header>

      {/* Output pane */}
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

        {/* Scroll-to-bottom FAB */}
        {!pinnedToBottom && (
          <button
            class="absolute bottom-4 right-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-3 py-1.5 rounded-full shadow-lg transition-colors"
            onClick={() => {
              setPinnedToBottom(true);
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }}
          >
            ↓ Scroll to bottom
          </button>
        )}
      </div>
    </div>
  );
}
