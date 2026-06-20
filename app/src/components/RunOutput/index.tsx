import { useState, useEffect } from 'preact/hooks';
import { navigate } from '../../utils/navigate.ts';
import { TERMINAL_STATUSES, type RunMeta } from './types.ts';
import { StaticOutput } from './StaticOutput.tsx';
import { StreamingOutput } from './StreamingOutput.tsx';

// ---------------------------------------------------------------------------
// Root component — fetches metadata and picks the right view
// ---------------------------------------------------------------------------

export default function RunOutput() {
  const parts = window.location.pathname.split('/');
  const jobId = parts[2] ?? '';
  const runId = parts[4] ?? '';

  const [meta, setMeta] = useState<RunMeta | null>(null);
  const status = TERMINAL_STATUSES.has(meta?.status ?? '');

  useEffect(() => {
    // Reset to the loading state when the run id changes (e.g. after seamlessly following a
    // judge continuation) so we don't briefly render the previous run's terminal view.
    setMeta(null);
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
            class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors whitespace-nowrap"
            onClick={() => navigate(`/jobs/${jobId}`)}
          >
            ← Back
          </button>
        </header>
        <div class="flex-1 bg-black flex items-center justify-center">
          <div class="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (status) {
    return <StaticOutput jobId={jobId} runId={runId} meta={meta} />;
  }

  return <StreamingOutput jobId={jobId} runId={runId} meta={meta} onMetaUpdate={setMeta} />;
}
