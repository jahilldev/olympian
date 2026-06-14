import { useState, useEffect } from 'preact/hooks';
import type { JobDetailDto, FeedbackDto } from '@olympian/api/job/job.model.js';
import type { ReviewPassDto } from '@olympian/api/review/review.model.js';
import type { AgentRunDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from './App.tsx';
import StateBadge from './StateBadge.tsx';
import Timeline from './Timeline.tsx';
import ReviewPassCard from './ReviewPassCard.tsx';
import PlanViewer from './PlanViewer.tsx';
import AgentRunRow from './AgentRunRow.tsx';

interface Props {
  id: string;
}

const TERMINAL_STATES = new Set(['DONE', 'FAILED', 'CANCELLED']);

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function FeedbackList({ items }: { items: FeedbackDto[] }) {
  if (items.length === 0) return null;
  return (
    <div class="space-y-2">
      {items.map((f) => (
        <div key={f.id} class="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-1">
          <div class="flex items-center justify-between text-xs text-zinc-500">
            <span class="font-mono text-zinc-400">@{f.author}</span>
            <span>{relativeTime(f.createdAt)}</span>
          </div>
          <p class="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{f.body}</p>
        </div>
      ))}
    </div>
  );
}

function ReviewCycles({ passes }: { passes: ReviewPassDto[] }) {
  const cycles = [...new Set(passes.map((p) => p.cycle))].sort((a, b) => a - b);
  const [activeCycle, setActiveCycle] = useState(cycles[cycles.length - 1] ?? 1);

  useEffect(() => {
    if (cycles.length > 0) setActiveCycle(cycles[cycles.length - 1]);
  }, [passes.length]);

  if (cycles.length === 0) return null;

  const cyclePass = passes.filter((p) => p.cycle === activeCycle);

  return (
    <div class="space-y-3">
      <div class="flex gap-1 flex-wrap">
        {cycles.map((c) => (
          <button
            key={c}
            onClick={() => setActiveCycle(c)}
            class={`text-xs px-3 py-1 rounded font-mono transition-colors ${
              c === activeCycle
                ? 'bg-zinc-700 text-zinc-100'
                : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'
            }`}
          >
            Cycle {c}
          </button>
        ))}
      </div>
      <div class="space-y-3">
        {cyclePass.map((p) => (
          <ReviewPassCard key={p.id} pass={p} />
        ))}
      </div>
    </div>
  );
}

export default function JobDetail({ id }: Props) {
  const [job, setJob] = useState<JobDetailDto | null>(null);
  const [reviews, setReviews] = useState<ReviewPassDto[]>([]);
  const [runs, setRuns] = useState<AgentRunDto[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [planOpen, setPlanOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchAll() {
      try {
        const res = await fetch(`/jobs/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = (await res.json()) as JobDetailDto;
        if (!cancelled) setJob(data);

        if (TERMINAL_STATES.has(data.state) && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        // network error — keep polling
      }

      try {
        const [revRes, runRes] = await Promise.all([
          fetch(`/jobs/${id}/reviews`),
          fetch(`/jobs/${id}/runs`),
        ]);
        if (!cancelled) {
          if (revRes.ok) setReviews((await revRes.json()) as ReviewPassDto[]);
          if (runRes.ok) setRuns((await runRes.json()) as AgentRunDto[]);
        }
      } catch {
        // non-fatal
      }
    }

    void fetchAll();
    timer = setInterval(() => void fetchAll(), 2_000);

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [id]);

  if (notFound) {
    return (
      <div class="flex flex-col items-center justify-center h-full text-zinc-500">
        <p class="text-lg">Job not found</p>
        <button
          class="mt-4 text-sm text-indigo-400 hover:text-indigo-300"
          onClick={() => navigate('/')}
        >
          ← All jobs
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div class="flex items-center justify-center h-full">
        <div class="w-6 h-6 border-2 border-zinc-600 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const latestApprovedPlan =
    [...job.plans].reverse().find((p) => p.status === 'APPROVED') ??
    job.plans[job.plans.length - 1] ??
    null;

  return (
    <div class="flex flex-col h-full overflow-hidden">
      {/* Top nav */}
      <header class="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 shrink-0">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate('/')}
        >
          ← All jobs
        </button>
        <span class="text-zinc-700">/</span>
        <span class="text-sm text-zinc-400 font-mono truncate">
          {job.repoFullName} #{job.issueNumber}
        </span>
      </header>

      {/* Body — two columns */}
      <div class="flex-1 overflow-hidden flex flex-col lg:flex-row">
        {/* Left column */}
        <div class="lg:w-3/5 overflow-y-auto p-6 space-y-6 border-b lg:border-b-0 lg:border-r border-zinc-800">
          {/* Title + badge */}
          <div class="space-y-2">
            <h1 class="text-xl font-semibold text-zinc-100 leading-snug">{job.issueTitle}</h1>
            <div class="flex flex-wrap items-center gap-2">
              <StateBadge state={job.state} />
              <a
                href={`https://github.com/${job.repoFullName}/issues/${job.issueNumber}`}
                class="text-xs text-zinc-500 hover:text-zinc-400"
                target="_blank"
                rel="noopener noreferrer"
              >
                {job.repoFullName} #{job.issueNumber}
              </a>
            </div>
          </div>

          {/* Error */}
          {job.error && (
            <div class="rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300 font-mono whitespace-pre-wrap">
              {job.error}
            </div>
          )}

          {/* PR info */}
          {job.prNumber && (
            <div class="flex items-center gap-3 text-sm rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
              <a
                href={job.prUrl ?? '#'}
                class="text-sky-400 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                PR #{job.prNumber}
              </a>
              {job.prIsDraft && (
                <span class="text-xs bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded">draft</span>
              )}
              {job.headSha && (
                <span class="text-xs text-zinc-500 font-mono ml-auto">
                  {job.headSha.slice(0, 7)}
                </span>
              )}
            </div>
          )}

          {/* Plan */}
          {latestApprovedPlan && (
            <div class="space-y-2">
              <button
                class="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={() => setPlanOpen((o) => !o)}
              >
                <span class="font-mono">{planOpen ? '▾' : '▸'}</span> Plan
              </button>
              {planOpen && <PlanViewer plan={latestApprovedPlan} />}
            </div>
          )}

          {/* Plan feedback */}
          {job.planFeedback.length > 0 && (
            <div class="space-y-2">
              <h3 class="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Plan feedback
              </h3>
              <FeedbackList items={job.planFeedback} />
            </div>
          )}

          {/* Timeline */}
          <div class="space-y-2">
            <h3 class="text-xs font-medium text-zinc-500 uppercase tracking-wide">Timeline</h3>
            <Timeline transitions={job.transitions} />
          </div>
        </div>

        {/* Right column */}
        <div class="lg:w-2/5 overflow-y-auto p-6 space-y-6">
          {/* Review cycles */}
          {reviews.length > 0 && (
            <div class="space-y-2">
              <h3 class="text-xs font-medium text-zinc-500 uppercase tracking-wide">Reviews</h3>
              <ReviewCycles passes={reviews} />
            </div>
          )}

          {/* PR feedback */}
          {job.prFeedback.length > 0 && (
            <div class="space-y-2">
              <h3 class="text-xs font-medium text-zinc-500 uppercase tracking-wide">PR feedback</h3>
              <FeedbackList items={job.prFeedback} />
            </div>
          )}

          {/* Agent runs */}
          {runs.length > 0 && (
            <div class="space-y-1">
              <h3 class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Runs</h3>
              {runs.map((run) => (
                <AgentRunRow key={run.id} run={run} jobId={id} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
