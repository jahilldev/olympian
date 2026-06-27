import { useState, useEffect } from 'preact/hooks';
import type { VerifyRunDto } from '@olympian/api/verify/verify.model.js';
import { navigate } from '../utils/navigate.ts';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Strip ANSI escape codes so raw terminal output renders cleanly. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

export default function VerifyOutput() {
  const parts = window.location.pathname.split('/');
  const jobId = parts[2] ?? '';
  const vid = parts[4] ?? '';

  const [run, setRun] = useState<VerifyRunDto | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/verifications/${vid}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (res.ok && !cancelled) setRun((await res.json()) as VerifyRunDto);
      } catch {
        // leave in loading state on transient errors
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, vid]);

  if (notFound) {
    return (
      <div class="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
        <p class="text-base">Verification not found</p>
        <button
          class="text-sm text-indigo-400 hover:text-indigo-300"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          Back to job
        </button>
      </div>
    );
  }

  if (!run) {
    return (
      <div class="flex items-center justify-center h-full">
        <div class="w-6 h-6 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const output = stripAnsi(run.output).trim();

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
        <span class="font-mono text-xs px-2 py-0.5 rounded shrink-0 bg-teal-900/60 text-teal-300">
          VERIFY
        </span>
        <span class={`text-xs font-medium ${run.ok ? 'text-teal-400' : 'text-red-400'}`}>
          {run.ok ? '✓ passed' : '✗ failed'}
        </span>
        <span class="text-xs text-zinc-600">attempt {run.attempt}</span>
        <span class="ml-auto text-xs text-zinc-600 shrink-0">{formatDuration(run.durationMs)}</span>
      </header>

      <div class="flex-1 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-4 py-5 space-y-4">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
              Command
            </h2>
            <code class="block text-xs text-zinc-300 font-mono break-all bg-zinc-900 rounded p-3 border border-zinc-800">
              {run.command}
            </code>
          </div>

          <div>
            <h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
              Output
            </h2>
            {output.length > 0 ? (
              <pre class="text-xs text-zinc-300 font-mono whitespace-pre-wrap break-words bg-zinc-950 rounded p-3 border border-zinc-800">
                {output}
              </pre>
            ) : (
              <p class="text-xs text-zinc-600 italic">No output captured.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
