import { useState } from 'preact/hooks';
import type { LangfuseEvent } from '@olympian/api/langfuse/langfuse.model.js';
import { IconCompress } from './Icons.tsx';
import { fmtTime, splitThinking } from './format.tsx';
import {
  ChatMessages,
  isChatMessages,
  obsPreview,
  parseObs,
  SectionToggle,
} from './Observations.tsx';

/**
 * Detects an EXPLICIT compression span — one Hermes labels with task="compression"
 * (in the span name, a *.task attribute, or serialised metadata). When present this
 * carries the summary output, so we render it as a rich card. It is not guaranteed
 * to appear in the stream, so the primary signal is the input-token drop detected
 * in `compressionDrops()` below.
 */
export function isExplicitCompression(event: LangfuseEvent): boolean {
  const body = event.body;
  const name = String(body['langfuse.observation.name'] ?? body.name ?? '').toLowerCase();
  if (/compress|summari[sz]/.test(name)) return true;
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && /task$/i.test(k) && v.toLowerCase() === 'compression') return true;
  }
  const meta = body['langfuse.observation.metadata'];
  return typeof meta === 'string' && /"task"\s*:\s*"compression"/i.test(meta);
}

/**
 * True prompt-token count for a generation event, or null. Prompt-caching providers (DeepSeek,
 * Anthropic, …) report `input` as the cache-MISS tokens only and put the cached prefix in a
 * separate field — so the real context size is `input + cache_read + cache_creation`. Summing them
 * is essential: without it a warm cache hit (e.g. input 67k → 3k while 69k is cached) looks like a
 * context drop and is misread as a compression. These cache fields are reported *separately from*
 * `input` (not a subset of it), so the sum never double-counts.
 */
export function inputTokens(event: LangfuseEvent): number | null {
  if ((event.body['langfuse.observation.type'] as string | undefined) !== 'generation') return null;
  const raw = event.body['langfuse.observation.usage_details'] as string | undefined;
  if (!raw) return null;
  try {
    const usage = JSON.parse(raw) as Record<string, unknown>;
    if (typeof usage.input !== 'number') return null;
    const num = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : 0);
    return usage.input + num('cache_read_input_tokens') + num('cache_creation_input_tokens');
  } catch {
    return null;
  }
}

/**
 * Infers compression from its OBSERVABLE EFFECT: within a single conversation, prompt-token
 * count only ever grows as context accumulates, so a sharp drop means the conversation was
 * compressed in between. Crucially this is tracked PER traceId: a run's stream interleaves
 * the main agent with its delegate_task children, and each child is a separate trace that
 * starts with a small fresh context — a cross-trace "drop" is delegation, not compression.
 * Returns a map of event index → { before, after } token counts at each real drop.
 */
export function compressionDrops(
  events: LangfuseEvent[],
): Map<number, { before: number; after: number }> {
  const drops = new Map<number, { before: number; after: number }>();
  const lastByTrace = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const cur = inputTokens(events[i]);
    if (cur === null) continue;
    const trace = String(events[i].body.traceId ?? '');
    const prev = lastByTrace.get(trace);
    // >20% drop and a meaningful absolute reduction — well clear of token-accounting noise.
    if (prev !== undefined && cur < prev * 0.8 && prev - cur > 2000) {
      drops.set(i, { before: prev, after: cur });
    }
    lastByTrace.set(trace, cur);
  }
  return drops;
}

export function CompressionCard({ event }: { event: LangfuseEvent }) {
  const [outputOpen, setOutputOpen] = useState(true);
  const [inputOpen, setInputOpen] = useState(false);
  const body = event.body;
  const model = body['langfuse.observation.model.name'] as string | undefined;
  const usageRaw = body['langfuse.observation.usage_details'] as string | undefined;
  const usage = usageRaw ? (JSON.parse(usageRaw) as Record<string, number>) : null;
  const inTok = usage?.input ?? null;
  const outTok = usage?.output ?? null;

  const rawOutput = body['langfuse.observation.output'] as string | undefined;
  const rawInput = body['langfuse.observation.input'] as string | undefined;
  const parsedOutput = parseObs(rawOutput);
  const summary =
    typeof parsedOutput === 'string'
      ? parsedOutput
      : typeof (parsedOutput as Record<string, unknown>)?.content === 'string'
        ? ((parsedOutput as Record<string, unknown>).content as string)
        : rawOutput
          ? String(rawOutput)
          : '';
  const { output: cleanSummary } = summary ? splitThinking(summary) : { output: '' };

  return (
    <div class="rounded-xl border border-cyan-900/50 overflow-hidden text-xs shadow-sm">
      <div class="flex items-center gap-2 px-3 py-2.5 bg-cyan-950/40 text-cyan-200">
        <IconCompress />
        <span class="font-semibold font-mono tracking-wide uppercase">compression</span>
        {model && (
          <span class="text-zinc-500 font-mono font-normal truncate flex-1 min-w-0">{model}</span>
        )}
        {inTok != null && outTok != null && (
          <span class="text-zinc-600 font-mono text-[10px] tabular-nums">
            {inTok.toLocaleString()}→{outTok.toLocaleString()} tok
          </span>
        )}
        <span class="ml-auto shrink-0 text-zinc-700 font-mono text-[10px] tabular-nums">
          {fmtTime(event.timestamp)}
        </span>
      </div>

      {rawInput && (
        <>
          <SectionToggle
            open={inputOpen}
            onToggle={() => setInputOpen((o) => !o)}
            label="Compressed input"
            preview={obsPreview(rawInput)}
            borderClass="border-cyan-900/30"
          />
          {inputOpen && (
            <div class="border-t border-zinc-800/40 px-3 py-3 bg-zinc-950/70 max-h-72 overflow-y-auto">
              {(() => {
                const p = parseObs(rawInput);
                if (isChatMessages(p)) return <ChatMessages messages={p} />;
                return (
                  <pre class="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed">
                    {typeof p === 'string' ? p : JSON.stringify(p, null, 2)}
                  </pre>
                );
              })()}
            </div>
          )}
        </>
      )}

      <SectionToggle
        open={outputOpen}
        onToggle={() => setOutputOpen((o) => !o)}
        label="Summary output"
        preview={cleanSummary.split('\n')[0]?.slice(0, 80)}
        borderClass="border-cyan-900/30"
        labelClass="text-cyan-300"
      />
      {outputOpen && (
        <div class="border-t border-zinc-800/40 px-3 py-3 bg-black/15 max-h-80 overflow-y-auto">
          {cleanSummary ? (
            <pre class="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
              {cleanSummary}
            </pre>
          ) : (
            <span class="text-zinc-700 italic text-[11px]">no output captured</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Inline divider marking that a context compression happened between two turns. */
export function CompressionMarker({
  before,
  after,
  contextLength,
}: {
  before: number;
  after: number;
  contextLength: number;
}) {
  const pct = (t: number) => Math.round((t / contextLength) * 100);
  const k = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t));
  return (
    <div class="mb-3 flex items-center gap-2 sm:gap-3">
      <div class="h-px flex-1 bg-zinc-800" />
      <div class="flex shrink-0 items-center gap-2 rounded-xl border border-cyan-900/50 bg-cyan-950/30 px-3 py-1.5 text-cyan-500">
        <IconCompress />
        <span class="text-[11px] font-mono font-semibold uppercase tracking-wide">Compress</span>
        <span class="whitespace-nowrap text-[10px] font-mono text-cyan-600 tabular-nums">
          {k(before)}→{k(after)} tok · {pct(before)}%→{pct(after)}%
        </span>
      </div>
      <div class="h-px flex-1 bg-zinc-800" />
    </div>
  );
}
