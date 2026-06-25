import { useState, useEffect, useRef } from 'preact/hooks';
import type { JobSummaryDto } from '@olympian/api/job/job.model.js';
import { navigate } from '../utils/navigate.ts';
import { jobSourceLabel } from '../utils/job.ts';
import JobCard from './JobCard.tsx';
import StateBadge from './StateBadge.tsx';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
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

function MobileJobCard({ job }: { job: JobSummaryDto }) {
  const title = job.issueTitle.length > 70 ? job.issueTitle.slice(0, 69) + '…' : job.issueTitle;
  return (
    <div
      class="border-b border-zinc-800/60 px-4 py-4 flex items-center gap-3 active:bg-zinc-900/60 cursor-pointer"
      onClick={() => navigate(`/jobs/${job.id}`)}
    >
      <div class="flex-1 min-w-0 space-y-2">
        <p class="text-sm font-medium text-zinc-100 leading-snug truncate">{title}</p>
        <div class="flex items-center gap-2 text-xs flex-wrap">
          <StateBadge state={job.state} />
          <span class="font-mono text-zinc-600">{jobSourceLabel(job)}</span>
          {job.activeRun && (
            <span class="flex items-center gap-1 text-green-400">
              <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {job.activeRun.phase}
            </span>
          )}
          {job.prNumber && (
            <span class={job.prIsDraft ? 'text-zinc-600' : 'text-sky-400'}>PR #{job.prNumber}</span>
          )}
          {job.confidence !== null && (
            <span
              class={
                job.confidence >= 85
                  ? 'text-green-400'
                  : job.confidence >= 70
                    ? 'text-amber-400'
                    : 'text-red-400'
              }
            >
              {job.confidence}%
            </span>
          )}
          <span class="ml-auto text-zinc-600">{relativeTime(job.updatedAt)}</span>
        </div>
      </div>
      <svg
        class="w-4 h-4 text-zinc-700 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
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

function InstallOverlay({
  onInstall,
  onDismiss,
}: {
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div class="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-80 z-50 animate-in">
      <div class="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/60 p-3 flex items-center gap-3">
        <img src="/icons/icon-192.png" class="w-11 h-11 rounded-xl shrink-0" alt="" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-zinc-100 leading-tight">Install Olympian</p>
          <p class="text-xs text-zinc-500 mt-0.5">Add to your home screen</p>
        </div>
        <button
          onClick={onInstall}
          class="shrink-0 text-xs font-semibold text-zinc-900 bg-zinc-100 hover:bg-white rounded-lg px-3 py-1.5 transition-colors"
        >
          Install
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          class="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors p-1"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function JobList() {
  const [jobs, setJobs] = useState<JobSummaryDto[] | null>(null);
  const [error, setError] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const installPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  async function startChat() {
    setCreatingChat(true);
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        navigate(`/chats/${id}`);
        return;
      }
    } catch {
      // fall through
    }
    setCreatingChat(false);
  }

  useEffect(() => {
    // Don't show the overlay when already running as an installed PWA.
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone
    ) {
      return;
    }
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      installPrompt.current = e as BeforeInstallPromptEvent;
      setInstallable(true);
    }
    function onAppInstalled() {
      installPrompt.current = null;
      setInstallable(false);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function handleInstall() {
    const prompt = installPrompt.current;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      installPrompt.current = null;
      setInstallable(false);
    }
  }

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
      <header class="flex items-center gap-3 px-4 sm:px-6 py-3.5 border-b border-zinc-800 shrink-0">
        <span class="text-base font-mono font-semibold tracking-tight text-zinc-100">Olympian</span>
        {jobs !== null && (
          <span class="flex items-center gap-1.5 text-xs font-mono text-zinc-500">
            {activeCount > 0 && (
              <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            )}
            {activeCount > 0 ? `${activeCount} active` : 'idle'}
          </span>
        )}
        <div class="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate('/create')}
            class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            Create
          </button>
          <button
            disabled={creatingChat}
            onClick={() => void startChat()}
            class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {creatingChat ? 'Starting…' : 'Chat'}
          </button>
        </div>
      </header>

      {installable && !dismissed && (
        <InstallOverlay onInstall={handleInstall} onDismiss={() => setDismissed(true)} />
      )}

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
                  class="py-2.5 px-4 text-xs font-medium text-zinc-600 uppercase tracking-widest"
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
