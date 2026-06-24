import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import type { LangfuseEvent, StreamPayload } from '@olympian/api/langfuse/langfuse.model.js';
import { navigate } from '../../utils/navigate.ts';
import { formatDuration, statusDot } from './format.tsx';
import { IconCompress } from './Icons.tsx';
import { EventCard } from './EventCard.tsx';
import {
  CompressionMarker,
  compressionDrops,
  inputTokens,
  isExplicitCompression,
} from './Compression.tsx';
import type { RunMeta } from './types.ts';

export function StreamingOutput({
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
  const [streamStatus, setStreamStatus] = useState<
    'connecting' | 'live' | 'done' | 'error' | 'following'
  >('connecting');
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextLength, setContextLength] = useState(131072);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ contextLength?: number }>)
          : Promise.reject(new Error(`${r.status}`)),
      )
      .then(({ contextLength: cl }) => {
        if (cl !== undefined) setContextLength(cl);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // keep defaults on failure
      });
    return () => controller.abort();
  }, []);

  // Spans arrive parent-last: an OTLP span is exported when it ENDS, and a delegate_task span ends
  // only after the sub-agent it wraps has finished — so its tool card would otherwise render AFTER
  // the sub-agent's activity. Render in true chronological order by span start time (the event's
  // `timestamp`, an ISO string that sorts correctly), with arrival order as a stable tiebreaker.
  const orderedEvents = useMemo(() => {
    return events
      .map((ev, i) => ({ ev, i }))
      .sort((a, b) => {
        if (a.ev.timestamp !== b.ev.timestamp) return a.ev.timestamp < b.ev.timestamp ? -1 : 1;
        return a.i - b.i;
      })
      .map((x) => x.ev);
  }, [events]);

  // Compression is inferred from the input-token drop between turns (see
  // compressionDrops), plus any explicitly-labelled compression span.
  const drops = useMemo(() => compressionDrops(orderedEvents), [orderedEvents]);
  const compressionCount = useMemo(
    () => drops.size + orderedEvents.reduce((n, ev) => n + (isExplicitCompression(ev) ? 1 : 0), 0),
    [drops, orderedEvents],
  );

  // The parent agent's trace is the first one we see; delegate_task children run as separate
  // traces under the same session. Anything not on the parent trace is sub-agent activity.
  const parentTraceId = useMemo(() => {
    for (const ev of orderedEvents) {
      const t = String(ev.body.traceId ?? '');
      if (t) return t;
    }
    return null;
  }, [orderedEvents]);

  const contextPct = useMemo(() => {
    // Track the MAIN agent's context only — the first generation's trace. A run's stream
    // interleaves delegate_task children (separate traces) whose small fresh contexts would
    // otherwise make the meter lurch down without any compression having happened.
    let mainTrace: string | null = null;
    let latestInput: number | null = null;
    for (const ev of orderedEvents) {
      const cur = inputTokens(ev);
      if (cur === null) continue;
      const trace = String(ev.body.traceId ?? '');
      if (mainTrace === null) mainTrace = trace;
      if (trace === mainTrace) latestInput = cur;
    }
    if (latestInput === null) return null;
    return Math.min(100, Math.round((latestInput / contextLength) * 100));
  }, [orderedEvents, contextLength]);

  useEffect(() => {
    const es = new EventSource(`/stream/runs/${runId}`);
    let cancelled = false;

    // When this run ends, the orchestrator may start another almost immediately (a judge
    // evaluation, then a judge-driven continuation, or the next phase). Poll briefly for a
    // successor RUNNING run and switch the live view to it, so the stream resumes seamlessly.
    const followNextRun = async () => {
      for (let i = 0; i < 30 && !cancelled; i++) {
        try {
          const r = await fetch(`/api/jobs/${jobId}/runs`);
          if (r.ok) {
            const all = (await r.json()) as { id: string; status: string }[];
            const next = all.find((x) => x.status === 'RUNNING' && x.id !== runId);
            if (next && !cancelled) {
              navigate(`/jobs/${jobId}/runs/${next.id}`);
              return;
            }
          }
        } catch {
          // transient — retry
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
      if (!cancelled) setStreamStatus('done');
    };

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
        es.close();
        setStreamStatus('following');
        void followNextRun();
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

    return () => {
      cancelled = true;
      es.close();
    };
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

  const ctxColour =
    contextPct === null
      ? null
      : contextPct < 60
        ? ({ bar: 'bg-green-500', text: 'text-green-400' } as const)
        : contextPct < 80
          ? ({ bar: 'bg-amber-500', text: 'text-amber-400' } as const)
          : ({ bar: 'bg-red-500', text: 'text-red-400' } as const);

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <button
          class="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          ← Back
        </button>
        <span class="text-zinc-700 text-sm">/</span>
        {meta && (
          <>
            <span class="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
              {meta.phase}
            </span>
            {meta.model && <span class="text-xs text-zinc-500 truncate">{meta.model}</span>}
            <span class="flex items-center gap-1.5">
              {statusDot(
                streamStatus === 'connecting' || streamStatus === 'following'
                  ? 'CONNECTING'
                  : meta.status,
              )}
            </span>
            {meta.durationMs !== null && (
              <span class="text-xs text-zinc-500">{formatDuration(meta.durationMs)}</span>
            )}
          </>
        )}
        <div class="flex items-center gap-3 ml-auto">
          {compressionCount > 0 && (
            <div
              class="flex items-center gap-1 text-cyan-400"
              title={`${compressionCount} context compression${compressionCount > 1 ? 's' : ''} this run`}
            >
              <IconCompress />
              <span class="text-xs font-mono tabular-nums">{compressionCount}</span>
            </div>
          )}
          {contextPct !== null && ctxColour !== null && (
            <div class="flex items-center gap-1.5">
              <div class="w-8 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  class={`h-full rounded-full transition-all ${ctxColour.bar}`}
                  style={{ width: `${Math.min(100, contextPct)}%` }}
                />
              </div>
              <span class={`text-xs font-mono tabular-nums ${ctxColour.text}`}>{contextPct}%</span>
              <span class="text-xs text-zinc-600">ctx</span>
            </div>
          )}
        </div>
      </header>

      <div class="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          class="h-full overflow-y-auto bg-black px-5 py-4 space-y-3 font-mono text-sm"
        >
          {orderedEvents.length === 0 && streamStatus === 'live' && (
            <p class="text-zinc-700 italic text-xs">Waiting for agent activity…</p>
          )}
          {orderedEvents.map((ev, i) => {
            // An explicit compression span isn't part of the main-loop turn flow,
            // so don't let it start a new "turn" divider.
            const isMainGen = (e: LangfuseEvent) =>
              (e.body['langfuse.observation.type'] as string | undefined) === 'generation' &&
              !isExplicitCompression(e);
            const drop = drops.get(i);
            const showDivider = !drop && isMainGen(ev) && i > 0 && !isMainGen(orderedEvents[i - 1]);
            const evTrace = String(ev.body.traceId ?? '');
            const isSubagent =
              parentTraceId !== null && evTrace !== '' && evTrace !== parentTraceId;
            return (
              <div key={i}>
                {drop && (
                  <CompressionMarker
                    before={drop.before}
                    after={drop.after}
                    contextLength={contextLength}
                  />
                )}
                {showDivider && <hr class="border-zinc-800 my-4" />}
                <EventCard event={ev} isSubagent={isSubagent} />
              </div>
            );
          })}
          {streamStatus === 'following' && (
            <p class="flex items-center gap-2 text-cyan-400 text-xs pt-2 border-t border-zinc-900">
              <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Run finished — the judge is evaluating; following the next run…
            </p>
          )}
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
