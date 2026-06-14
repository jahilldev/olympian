import type { AgentRunDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from '../utils/navigate.ts';

interface Props {
  run: AgentRunDto;
  jobId: string;
}

const PHASE_COLOURS: Record<string, string> = {
  PLAN: 'bg-violet-900/60 text-violet-300',
  IMPLEMENT: 'bg-sky-900/60 text-sky-300',
  REVIEW: 'bg-amber-900/60 text-amber-300',
  TEST: 'bg-teal-900/60 text-teal-300',
};

function phasePill(phase: string): string {
  return PHASE_COLOURS[phase] ?? 'bg-zinc-800 text-zinc-300';
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

export default function AgentRunRow({ run, jobId }: Props) {
  const isRunning = run.status === 'RUNNING';
  const canView = run.hasOutput || isRunning;

  return (
    <div
      class={`rounded-lg border p-3 transition-colors ${
        isRunning ? 'border-green-800 bg-green-950/20' : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      <div class="flex items-center gap-3">
        {/* Phase badge */}
        <span class={`font-mono text-xs px-2.5 py-1 rounded shrink-0 ${phasePill(run.phase)}`}>
          {run.phase}
        </span>

        {/* Status + model */}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            {isRunning ? (
              <span class="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Running
              </span>
            ) : run.status === 'SUCCEEDED' ? (
              <span class="text-xs text-zinc-400">Completed</span>
            ) : run.status === 'FAILED' ? (
              <span class="text-xs text-red-400">
                Failed{run.exitCode !== null ? ` (exit ${run.exitCode})` : ''}
              </span>
            ) : (
              <span class="text-xs text-zinc-600">{run.status}</span>
            )}
            {run.model && <span class="text-xs text-zinc-600 font-mono truncate">{run.model}</span>}
          </div>
          {run.durationMs !== null && (
            <p class="text-xs text-zinc-600 mt-0.5 font-mono">{formatDuration(run.durationMs)}</p>
          )}
        </div>

        {/* Action button */}
        {canView && (
          <button
            class={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              isRunning
                ? 'bg-green-800 text-green-200 hover:bg-green-700'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
            onClick={() => navigate(`/jobs/${jobId}/runs/${run.id}`)}
          >
            {isRunning ? 'Watch →' : 'View →'}
          </button>
        )}
      </div>
    </div>
  );
}
