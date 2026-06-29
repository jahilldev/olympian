import { useState, useEffect } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { JudgementDto } from '@olympian/api/judge/judge.model.js';
import { navigate } from '../utils/navigate.ts';

export default function JudgeOutput() {
  const parts = window.location.pathname.split('/');
  const jobId = parts[2] ?? '';
  const jid = parts[4] ?? '';

  const [judgement, setJudgement] = useState<JudgementDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/judgements/${jid}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (res.ok && !cancelled) setJudgement((await res.json()) as JudgementDto);
      } catch {
        // leave in loading state on transient errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, jid]);

  if (notFound) {
    return (
      <div class="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
        <p class="text-base">Judgement not found</p>
        <button
          class="text-sm text-cyan-400 hover:text-cyan-300"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          Back to job
        </button>
      </div>
    );
  }

  if (!judgement) {
    return (
      <div class="flex items-center justify-center h-full">
        <div class="w-6 h-6 border-2 border-zinc-700 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  const { passed, output } = judgement;
  const html = output.trim() ? DOMPurify.sanitize(marked.parse(output) as string) : '';

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
        <span class="font-mono text-xs px-2 py-0.5 rounded shrink-0 bg-zinc-800 text-zinc-300">
          JUDGE
        </span>
        <span
          class={`text-xs font-medium ${passed === false ? 'text-amber-400' : passed ? 'text-green-400' : 'text-zinc-500'}`}
        >
          {passed === null ? 'verdict unknown' : passed ? '✓ criteria met' : '✗ criteria not met'}
        </span>
      </header>

      <div class="flex-1 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-4 py-5 space-y-4">
          {html ? (
            <div
              class="prose prose-sm prose-invert max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-200 prose-code:text-amber-300 prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-900 prose-pre:text-zinc-300 [&_pre_code]:text-zinc-300 prose-pre:border prose-pre:border-zinc-800"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p class="text-xs text-zinc-600 italic">No output recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
}
