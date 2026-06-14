import { useState, useEffect } from 'preact/hooks';
import type { JobSummaryDto } from '@olympian/api/job/job.model.js';
import { navigate } from '../utils/navigate.ts';
import JobCard from './JobCard.tsx';
import StateBadge from './StateBadge.tsx';

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

function MobileJobCard({ job }: { job: JobSummaryDto }) {
  const title = job.issueTitle.length > 70 ? job.issueTitle.slice(0, 69) + '…' : job.issueTitle;
  return (
    <div
      class="border-b border-zinc-800 px-4 py-3 flex items-start gap-3 active:bg-zinc-900 cursor-pointer"
      onClick={() => navigate(`/jobs/${job.id}`)}
    >
      <div class="shrink-0 pt-0.5">
        <StateBadge state={job.state} />
      </div>
      <div class="flex-1 min-w-0 space-y-1">
        <p class="text-sm text-zinc-200 leading-snug">{title}</p>
        <div class="flex items-center gap-2 text-xs text-zinc-600 flex-wrap">
          <span class="font-mono">
            {job.repoFullName} #{job.issueNumber}
          </span>
          {job.activeRun && (
            <span class="flex items-center gap-1 text-green-500">
              <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {job.activeRun.phase}
            </span>
          )}
          {job.prNumber && (
            <span class={job.prIsDraft ? 'text-zinc-600' : 'text-sky-500'}>PR #{job.prNumber}</span>
          )}
          {job.confidence !== null && (
            <span
              class={
                job.confidence >= 85
                  ? 'text-green-500'
                  : job.confidence >= 70
                    ? 'text-amber-500'
                    : 'text-red-500'
              }
            >
              {job.confidence}%
            </span>
          )}
          <span class="ml-auto">{relativeTime(job.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr class="border-b border-zinc-800">
      {[...Array(7)].map((_, i) => (
        <td key={i} class="py-3 px-4">
          <div
            class="h-4 bg-zinc-800 rounded animate-pulse"
            style={{ width: `${40 + ((i * 17) % 50)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

function SkeletonMobile() {
  return (
    <div class="border-b border-zinc-800 px-4 py-3 flex items-start gap-3">
      <div class="h-5 w-16 bg-zinc-800 rounded animate-pulse shrink-0" />
      <div class="flex-1 space-y-2">
        <div class="h-4 bg-zinc-800 rounded animate-pulse w-3/4" />
        <div class="h-3 bg-zinc-800 rounded animate-pulse w-1/2" />
      </div>
    </div>
  );
}

export default function JobList() {
  const [jobs, setJobs] = useState<JobSummaryDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchJobs() {
      try {
        const res = await fetch('/api/jobs');
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as JobSummaryDto[];
        if (!cancelled) {
          setJobs(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void fetchJobs();
    const timer = setInterval(() => void fetchJobs(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const activeCount = jobs?.filter((j) => !TERMINAL_STATES.has(j.state)).length ?? 0;

  return (
    <div class="flex flex-col h-full">
      {/* Header */}
      <header class="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-800 shrink-0">
        <span class="text-lg font-mono font-medium tracking-tight text-zinc-100">Olympian</span>
        {jobs !== null && (
          <span class="flex items-center gap-1.5 text-sm text-zinc-400">
            {activeCount > 0 && <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
            {activeCount > 0 ? `${activeCount} active` : 'idle'}
          </span>
        )}
      </header>

      {/* Error banner */}
      {error && (
        <div class="bg-red-950 border-b border-red-800 text-red-300 text-sm px-4 sm:px-6 py-2">
          Failed to fetch jobs — retrying…
        </div>
      )}

      <div class="flex-1 overflow-auto">
        {/* Mobile card list — only below sm */}
        <div class="sm:hidden">
          {jobs === null ? (
            <>
              <SkeletonMobile />
              <SkeletonMobile />
              <SkeletonMobile />
            </>
          ) : jobs.length === 0 ? (
            <p class="text-center text-sm text-zinc-600 py-16 px-4">
              No jobs yet. Add the <code class="font-mono text-zinc-500">hermes</code> label to a
              GitHub issue.
            </p>
          ) : (
            jobs.map((job) => <MobileJobCard key={job.id} job={job} />)
          )}
        </div>

        {/* Desktop table — hidden below sm */}
        <table class="w-full text-left hidden sm:table">
          <thead class="sticky top-0 bg-zinc-950 border-b border-zinc-800">
            <tr>
              {['State', 'Job', 'PR', 'Active', 'Confidence', 'Cycle', 'Updated'].map((h) => (
                <th
                  key={h}
                  class="py-2 px-4 text-xs font-medium text-zinc-500 uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs === null ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={7} class="py-16 text-center text-sm text-zinc-600">
                  No jobs yet. Add the <code class="font-mono text-zinc-500">hermes</code> label to
                  a GitHub issue to get started.
                </td>
              </tr>
            ) : (
              jobs.map((job) => <JobCard key={job.id} job={job} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
