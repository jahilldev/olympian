import type { AgentRunDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from './App.tsx';

interface Props {
  run: AgentRunDto;
  jobId: string;
}

function statusIndicator(status: string) {
  if (status === 'RUNNING')
    return <span class="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />;
  if (status === 'SUCCEEDED') return <span class="text-green-400">✓</span>;
  if (status === 'FAILED') return <span class="text-red-400">✗</span>;
  if (status === 'TIMED_OUT') return <span class="text-amber-400">⏱</span>;
  return <span class="text-zinc-500">—</span>;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export default function AgentRunRow({ run, jobId }: Props) {
  const canView = run.hasOutput || run.status === 'RUNNING';

  return (
    <div class="flex items-center gap-3 py-2 px-3 rounded hover:bg-zinc-800 transition-colors">
      <span class="font-mono text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded w-24 text-center shrink-0">
        {run.phase}
      </span>
      <span class="w-4 flex justify-center shrink-0">{statusIndicator(run.status)}</span>
      <span class="text-xs text-zinc-400 flex-1 truncate">{run.model ?? '—'}</span>
      <span class="text-xs text-zinc-500 font-mono tabular-nums shrink-0">
        {formatDuration(run.durationMs)}
      </span>
      {canView ? (
        <button
          class="text-xs text-indigo-400 hover:text-indigo-300 shrink-0"
          onClick={() => navigate(`/jobs/${jobId}/runs/${run.id}`)}
        >
          View output →
        </button>
      ) : (
        <span class="text-xs text-zinc-600 shrink-0 w-[88px]" />
      )}
    </div>
  );
}
