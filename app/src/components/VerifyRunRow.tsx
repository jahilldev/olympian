import type { VerifyRunDto } from '@olympian/api/verify/verify.model.js';
import { navigate } from '../utils/navigate.ts';

interface Props {
  run: VerifyRunDto;
  jobId: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default function VerifyRunRow({ run, jobId }: Props) {
  const hasOutput = run.output.trim().length > 0;

  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div class="flex items-center gap-3">
        <span class="font-mono text-xs px-2.5 py-1 rounded shrink-0 bg-teal-900/60 text-teal-300">
          VERIFY
        </span>

        <div class="flex-1 min-w-0 leading-tight">
          <span class={`text-xs font-medium ${run.ok ? 'text-teal-400' : 'text-red-400'}`}>
            {run.ok ? 'Passed' : 'Failed'}
          </span>
          <p class="text-xs text-zinc-600 mt-0 font-mono truncate">
            attempt {run.attempt} · {formatDuration(run.durationMs)}
          </p>
        </div>

        {hasOutput && (
          <button
            class="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            onClick={() => navigate(`/jobs/${jobId}/verifications/${run.id}`)}
          >
            View →
          </button>
        )}
      </div>
    </div>
  );
}
