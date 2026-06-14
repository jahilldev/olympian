import { useState, useEffect } from 'preact/hooks';
import type { JobSummaryDto } from '@olympian/api/job/job.model.js';
import JobCard from './JobCard.tsx';

const TERMINAL_STATES = new Set(['DONE', 'FAILED', 'CANCELLED']);

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
      <header class="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
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
        <div class="bg-red-950 border-b border-red-800 text-red-300 text-sm px-6 py-2">
          Failed to fetch jobs — retrying…
        </div>
      )}

      {/* Table */}
      <div class="flex-1 overflow-auto">
        <table class="w-full text-left">
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
