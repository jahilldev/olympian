import { useState, useEffect } from 'preact/hooks';
import type { JobDetailDto, FeedbackDto } from '@olympian/api/job/job.model.js';
import type { ReviewPassDto } from '@olympian/api/review/review.model.js';
import type { AgentRunDto } from '@olympian/api/agent/agent.model.js';
import type { VerifyRunDto } from '@olympian/api/verify/verify.model.js';
import { navigate } from '../utils/navigate.ts';
import StateBadge from './StateBadge.tsx';
import Timeline from './Timeline.tsx';
import ReviewPassCard from './ReviewPassCard.tsx';
import PlanViewer from './PlanViewer.tsx';
import AgentRunRow from './AgentRunRow.tsx';
import VerifyRunRow from './VerifyRunRow.tsx';

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

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">{children}</h2>
  );
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

  return (
    <div class="space-y-3">
      {cycles.length > 1 && (
        <div class="flex gap-1 flex-wrap">
          {cycles.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCycle(c)}
              class={`text-xs px-3 py-1 rounded font-mono transition-colors ${
                c === activeCycle
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800 border border-zinc-800'
              }`}
            >
              Cycle {c}
            </button>
          ))}
        </div>
      )}
      <div class="space-y-3">
        {passes
          .filter((p) => p.cycle === activeCycle)
          .map((p) => (
            <ReviewPassCard key={p.id} pass={p} />
          ))}
      </div>
    </div>
  );
}

export default function JobDetail() {
  const id = window.location.pathname.split('/')[2] ?? '';
  const [job, setJob] = useState<JobDetailDto | null>(null);
  const [reviews, setReviews] = useState<ReviewPassDto[]>([]);
  const [runs, setRuns] = useState<AgentRunDto[]>([]);
  const [verifications, setVerifications] = useState<VerifyRunDto[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchAll() {
      try {
        const res = await fetch(`/api/jobs/${id}`);
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
        const [revRes, runRes, verRes] = await Promise.all([
          fetch(`/api/jobs/${id}/reviews`),
          fetch(`/api/jobs/${id}/runs`),
          fetch(`/api/jobs/${id}/verifications`),
        ]);
        if (!cancelled) {
          if (revRes.ok) setReviews((await revRes.json()) as ReviewPassDto[]);
          if (runRes.ok) setRuns((await runRes.json()) as AgentRunDto[]);
          if (verRes.ok) setVerifications((await verRes.json()) as VerifyRunDto[]);
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
      <div class="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
        <p class="text-base">Job not found</p>
        <button class="text-sm text-indigo-400 hover:text-indigo-300" onClick={() => navigate('/')}>
          Back to all jobs
        </button>
      </div>
    );
  }

  if (!job) {
    return (
      <div class="flex items-center justify-center h-full">
        <div class="w-6 h-6 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const activeRun = runs.find((r) => r.status === 'RUNNING') ?? null;
  const latestPlan =
    [...job.plans].reverse().find((p) => p.status === 'APPROVED') ??
    job.plans[job.plans.length - 1] ??
    null;

  return (
    <div class="flex flex-col h-full overflow-hidden">
      {/* Compact sticky header */}
      <header class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <button
          class="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
          onClick={() => navigate('/')}
        >
          ←
        </button>
        <span class="text-zinc-700 text-sm">/</span>
        <span class="text-xs text-zinc-500 font-mono truncate min-w-0">
          {job.repoFullName} #{job.issueNumber}
        </span>
        <div class="ml-auto shrink-0">
          <StateBadge state={job.state} />
        </div>
      </header>

      {/* Scrollable single-column body */}
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-3xl mx-auto px-4 py-5 space-y-6">
          {/* Title + meta */}
          <div class="space-y-2">
            <h1 class="text-lg font-semibold text-zinc-100 leading-snug">{job.issueTitle}</h1>

            {/* Active run banner */}
            {activeRun && (
              <div class="rounded-lg border border-green-900 bg-green-950/30 px-3 py-2.5 flex items-center gap-2.5">
                <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                <span class="text-xs text-green-400 font-mono">{activeRun.phase}</span>
                {activeRun.model && (
                  <span class="text-xs text-green-900 truncate hidden sm:block">
                    {activeRun.model}
                  </span>
                )}
                <button
                  class="ml-auto shrink-0 text-xs font-medium text-green-300 hover:text-green-100 transition-colors"
                  onClick={() => navigate(`/jobs/${id}/runs/${activeRun.id}`)}
                >
                  Watch live →
                </button>
              </div>
            )}
            <div class="flex items-center gap-x-3 text-xs text-zinc-500 min-w-0">
              <a
                href={`https://github.com/${job.repoFullName}/issues/${job.issueNumber}`}
                class="hover:text-zinc-300 transition-colors truncate min-w-0"
                target="_blank"
                rel="noopener noreferrer"
              >
                {job.repoFullName} #{job.issueNumber}
              </a>
              {job.prNumber && (
                <a
                  href={job.prUrl ?? '#'}
                  class={`shrink-0 hover:underline ${job.prIsDraft ? 'text-zinc-500' : 'text-sky-400'}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  PR #{job.prNumber}
                  {job.prIsDraft ? ' (draft)' : ''}
                </a>
              )}
              {job.confidence !== null && (
                <span
                  class={`shrink-0 ${
                    job.confidence >= 85
                      ? 'text-green-400'
                      : job.confidence >= 70
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }`}
                >
                  {job.confidence}%
                </span>
              )}
              {job.reviewCycle > 0 && <span class="shrink-0">cycle {job.reviewCycle}</span>}
              <span class="ml-auto shrink-0 whitespace-nowrap">{relativeTime(job.updatedAt)}</span>
            </div>
          </div>

          {/* Error */}
          {job.error && (
            <div class="rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300 font-mono whitespace-pre-wrap">
              {job.error}
            </div>
          )}

          {/* Timeline — most important content section */}
          <section>
            <SectionHeading>Timeline</SectionHeading>
            <Timeline transitions={job.transitions} />
          </section>

          {/* Runs — agent runs and verify executions, interleaved chronologically */}
          {(runs.length > 0 || verifications.length > 0) && (
            <section>
              <SectionHeading>Runs</SectionHeading>
              <div class="space-y-2">
                {[
                  ...runs.map((r) => ({ kind: 'agent' as const, at: r.createdAt, run: r })),
                  ...verifications.map((v) => ({ kind: 'verify' as const, at: v.createdAt, run: v })),
                ]
                  .sort((a, b) => (a.at < b.at ? 1 : -1))
                  .map((item) =>
                    item.kind === 'agent' ? (
                      <AgentRunRow key={`a-${item.run.id}`} run={item.run} jobId={id} />
                    ) : (
                      <VerifyRunRow key={`v-${item.run.id}`} run={item.run} jobId={id} />
                    ),
                  )}
              </div>
            </section>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <section>
              <SectionHeading>Reviews</SectionHeading>
              <ReviewCycles passes={reviews} />
            </section>
          )}

          {/* PR feedback */}
          {job.prFeedback.length > 0 && (
            <section>
              <SectionHeading>PR feedback</SectionHeading>
              <FeedbackList items={job.prFeedback} />
            </section>
          )}

          {/* Plan — collapsed by default */}
          {latestPlan && (
            <section>
              <button
                class="flex items-center gap-2 w-full text-left mb-3 group"
                onClick={() => setPlanOpen((o) => !o)}
              >
                <h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-400 transition-colors">
                  Plan
                </h2>
                <span class="text-zinc-600 text-xs font-mono">{planOpen ? '▾' : '▸'}</span>
              </button>
              {planOpen && <PlanViewer plan={latestPlan} />}
            </section>
          )}

          {/* Plan feedback */}
          {job.planFeedback.length > 0 && (
            <section>
              <SectionHeading>Plan feedback</SectionHeading>
              <FeedbackList items={job.planFeedback} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
