import { useState } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { JudgementDto } from '@olympian/api/judge/judge.model.js';

interface Props {
  jobId: string;
  count: number;
  /** True when any evaluation found the acceptance criteria not yet met. */
  anyUnmet: boolean;
}

/**
 * A single aggregated card for ALL completion-judge evaluations (so the Runs list isn't
 * polluted with one row per check). Shows the count + whether criteria were ever unmet, and
 * expands to list each judge's critique.
 */
export default function JudgeCard({ jobId, count, anyUnmet }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JudgementDto[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null && !loading) {
      setLoading(true);
      fetch(`/api/jobs/${jobId}/judgements`)
        .then((r) => (r.ok ? (r.json() as Promise<JudgementDto[]>) : Promise.reject(new Error())))
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div
      class={`rounded-lg border ${anyUnmet ? 'border-amber-900/60 bg-amber-950/10' : 'border-zinc-800 bg-zinc-900/50'}`}
    >
      <div class="flex items-center gap-3 p-3">
        <span class="font-mono text-xs px-2.5 py-1 rounded shrink-0 bg-amber-900/50 text-amber-300">
          JUDGE
        </span>
        <div class="flex-1 min-w-0 leading-tight">
          <span class="text-xs text-zinc-300">
            {count} completion {count === 1 ? 'check' : 'checks'}
          </span>
          <div class={`text-xs mt-0 ${anyUnmet ? 'text-amber-400' : 'text-zinc-600'}`}>
            {anyUnmet ? 'criteria not met — agent continued' : 'criteria met'}
          </div>
        </div>
        <button
          class="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
          onClick={toggle}
        >
          {open ? 'Hide' : 'View →'}
        </button>
      </div>

      {open && (
        <div class="border-t border-zinc-800 divide-y divide-zinc-800/70">
          {loading && <p class="p-3 text-xs text-zinc-600 italic">Loading…</p>}
          {items?.map((it, i) => {
            const html = DOMPurify.sanitize(
              marked.parse(it.critique || '_No critique — criteria met._') as string,
            );
            return (
              <div key={it.id} class="p-3">
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="text-[10px] font-mono text-zinc-500">#{items.length - i}</span>
                  <span
                    class={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      it.met ? 'bg-green-900/50 text-green-300' : 'bg-amber-900/50 text-amber-300'
                    }`}
                  >
                    {it.met === null ? 'unknown' : it.met ? 'met' : 'not met'}
                  </span>
                </div>
                <div
                  class="prose prose-sm prose-invert max-w-none prose-p:text-zinc-300 prose-li:text-zinc-300 prose-headings:text-zinc-200 prose-strong:text-zinc-200 prose-code:text-amber-300"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </div>
            );
          })}
          {items && items.length === 0 && (
            <p class="p-3 text-xs text-zinc-600 italic">No evaluations recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}
