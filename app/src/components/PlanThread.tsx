import { useState } from 'preact/hooks';
import type { JobDetailDto } from '@olympian/api/job/job.model.js';
import Markdown from './Markdown.tsx';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * The dashboard job's requirements → plan-revision → feedback history, rendered as a
 * chronological conversation, with a feedback composer while awaiting plan approval.
 */
export default function PlanThread({
  job,
  pending,
  onSubmitFeedback,
}: {
  job: JobDetailDto;
  pending: boolean;
  onSubmitFeedback: (body: string) => Promise<boolean>;
}) {
  const [feedback, setFeedback] = useState('');

  const items = [
    ...job.plans.map((p) => ({ kind: 'plan' as const, at: p.createdAt, plan: p })),
    ...job.planFeedback.map((f) => ({ kind: 'feedback' as const, at: f.createdAt, fb: f })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));

  async function send() {
    if (feedback.trim().length === 0) return;
    const ok = await onSubmitFeedback(feedback.trim());
    if (ok) setFeedback('');
  }

  return (
    <div class="space-y-3">
      {/* Requirements (the "issue") */}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div class="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">
          Requirements
        </div>
        <Markdown text={job.issueBody || '_(no requirements provided)_'} />
      </div>

      {items.map((item) =>
        item.kind === 'plan' ? (
          <div key={item.plan.id} class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
            <div class="flex items-center gap-2 text-xs text-zinc-500">
              <span class="font-medium text-zinc-400">Plan revision {item.plan.revision}</span>
              <span
                class={`px-1.5 py-0.5 rounded font-mono ${
                  item.plan.status === 'APPROVED'
                    ? 'bg-green-900/50 text-green-400'
                    : item.plan.status === 'SUPERSEDED'
                      ? 'bg-zinc-800 text-zinc-500'
                      : 'bg-indigo-900/40 text-indigo-300'
                }`}
              >
                {item.plan.status}
              </span>
              <span class="ml-auto">{relativeTime(item.plan.createdAt)}</span>
            </div>
            <Markdown text={item.plan.content} />
          </div>
        ) : (
          <div
            key={item.fb.id}
            class="rounded-lg border border-zinc-800 bg-zinc-950 p-3 ml-6 space-y-1"
          >
            <div class="flex items-center justify-between text-xs text-zinc-500">
              <span class="font-mono text-zinc-400">@{item.fb.author}</span>
              <span>{relativeTime(item.fb.createdAt)}</span>
            </div>
            <p class="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{item.fb.body}</p>
          </div>
        ),
      )}

      {job.state === 'AWAITING_PLAN_APPROVAL' && (
        <div class="space-y-2 pt-1">
          <textarea
            value={feedback}
            onInput={(e) => setFeedback((e.target as HTMLTextAreaElement).value)}
            placeholder="Request changes to the plan (Markdown) — Hermes will revise and re-propose…"
            rows={4}
            class="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-600 resize-y"
          />
          <button
            disabled={pending || feedback.trim().length === 0}
            onClick={() => void send()}
            class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {pending ? 'Sending…' : 'Send feedback & re-plan'}
          </button>
        </div>
      )}
    </div>
  );
}
