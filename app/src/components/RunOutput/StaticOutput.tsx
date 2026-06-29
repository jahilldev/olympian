import { useState, useEffect, useRef } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AgentRunOutputDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from '../../utils/navigate.ts';
import { formatDuration, statusDot, stripAnsi } from './format.tsx';
import type { RunMeta } from './types.ts';

export function StaticOutput({
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

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="shrink-0 flex items-center gap-2 px-4 h-14 border-b border-zinc-800 bg-zinc-950">
        <button
          class="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          ← Back
        </button>
        <span class="text-zinc-700 text-sm">/</span>
        {meta && (
          <>
            <span class="shrink-0 text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
              {meta.phase}
            </span>
            {meta.model && <span class="min-w-0 truncate text-xs text-zinc-500">{meta.model}</span>}
            <span class="flex shrink-0 items-center gap-1.5">{statusDot(meta.status)}</span>
            {meta.durationMs !== null && (
              <span class="shrink-0 whitespace-nowrap text-xs text-zinc-500">
                {formatDuration(meta.durationMs)}
              </span>
            )}
          </>
        )}
      </header>

      <div ref={scrollRef} class="flex-1 overflow-y-auto bg-black px-4 py-6 sm:px-8">
        {error && <p class="text-red-400 text-xs font-mono">Failed to load output.</p>}
        {!output && !error && <p class="text-zinc-700 text-xs font-mono italic">Loading…</p>}
        {output &&
          (() => {
            const text = stripAnsi(output.stdout);
            if (!text) return <p class="text-zinc-700 italic text-sm">No output recorded.</p>;
            const rawHtml = marked.parse(text) as string;
            const wrapped = rawHtml
              .replace(/<table>/g, '<div class="overflow-x-auto w-full"><table class="min-w-full">')
              .replace(/<\/table>/g, '</table></div>');
            const html = DOMPurify.sanitize(wrapped);
            return (
              <div
                class="prose prose-sm sm:prose-base prose-invert max-w-none
                prose-headings:font-semibold prose-headings:text-zinc-100
                prose-p:text-zinc-300 prose-p:leading-relaxed
                prose-a:text-cyan-400 hover:prose-a:text-cyan-300
                prose-strong:text-zinc-200
                prose-code:text-amber-300 prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-zinc-900 prose-pre:text-zinc-300 [&_pre_code]:text-zinc-300 prose-pre:border prose-pre:border-zinc-800
                prose-blockquote:border-zinc-700 prose-blockquote:text-zinc-400
                prose-hr:border-zinc-800
                prose-li:text-zinc-300
                prose-table:text-zinc-300 prose-thead:border-zinc-700 prose-tbody:divide-zinc-800"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          })()}
      </div>
    </div>
  );
}
