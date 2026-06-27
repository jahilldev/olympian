import type { AgentRunDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from '../utils/navigate.ts';

interface Props {
  run: AgentRunDto;
  jobId: string;
}

const PHASE_COLOURS: Record<string, string> = {
  PLAN: 'bg-blue-900/60 text-blue-300',
  IMPLEMENT: 'bg-sky-900/60 text-sky-300',
  REVIEW: 'bg-violet-900/60 text-violet-300',
  REVISE: 'bg-sky-900/60 text-sky-300',
  VERIFY: 'bg-teal-900/60 text-teal-300',
  SUMMARY: 'bg-zinc-800 text-zinc-300',
  JUDGE: 'bg-pink-900/60 text-pink-300',
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
  const duration = run.durationMs !== null ? formatDuration(run.durationMs) : null;
  const isJudge = run.phase === 'JUDGE';
  // A finished judge run opens its dedicated critique page; everything else (and a still-running
  // judge, which you watch live) opens the run output.
  const viewHref =
    isJudge && !isRunning ? `/jobs/${jobId}/judgements/${run.id}` : `/jobs/${jobId}/runs/${run.id}`;

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

        {/* Status, with model + duration on a meta line beneath */}
        <div class="flex-1 min-w-0 leading-tight">
          {isRunning ? (
            <span class="flex items-center gap-1.5 text-xs text-green-400 font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Running
            </span>
          ) : isJudge && run.status === 'SUCCEEDED' ? (
            <span
              class={`text-xs font-medium ${run.judgePassed === false ? 'text-amber-400' : run.judgePassed ? 'text-green-400' : 'text-zinc-400'}`}
            >
              {run.judgePassed === false ? 'Failed' : run.judgePassed ? 'Passed' : 'Evaluated'}
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
          {(run.model || duration) && (
            <div class="flex items-center gap-1.5 text-xs text-zinc-600 mt-0 font-mono min-w-0">
              {run.model && <span class="truncate min-w-0">{run.model}</span>}
              {duration && <span class="shrink-0">{run.model ? `· ${duration}` : duration}</span>}
            </div>
          )}
        </div>

        {/* Action button */}
        {canView && (
          <button
            class={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
              isRunning
                ? 'bg-hermes-400 text-zinc-950 hover:bg-hermes-500'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
            onClick={() => navigate(viewHref)}
          >
            {isRunning ? 'Watch →' : 'View →'}
          </button>
        )}
      </div>
    </div>
  );
}
