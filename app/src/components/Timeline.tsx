import type { TransitionDto } from '@olympian/api/job/job.model.js';
import StateBadge from './StateBadge.tsx';

interface Props {
  transitions: TransitionDto[];
}

const ACTOR_STYLES: Record<string, string> = {
  HUMAN: 'text-blue-400',
  AGENT: 'text-violet-400',
  SYSTEM: 'text-zinc-500',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Timeline({ transitions }: Props) {
  if (transitions.length === 0) {
    return <p class="text-xs text-zinc-600 italic">No transitions yet.</p>;
  }

  const items = [...transitions].reverse();

  return (
    <ol class="relative ml-1.5 border-l border-zinc-800 space-y-3">
      {items.map((t, i) => (
        <li key={t.id} class="relative pl-5">
          {/* Node on the rail; brighter for the most recent transition */}
          <span
            class={`absolute left-0 top-1 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-4 ring-zinc-950 ${
              i === 0 ? 'bg-zinc-300' : 'bg-zinc-700'
            }`}
          />

          {/* Top line: state + time, always on one row */}
          <div class="flex items-center justify-between gap-3">
            <StateBadge state={t.toState} />
            <time class="shrink-0 text-[11px] text-zinc-600 tabular-nums">
              {relativeTime(t.createdAt)}
            </time>
          </div>

          {/* Detail line: actor + reason, wraps freely */}
          <p class="mt-1 text-xs leading-snug break-words">
            <span class={`font-mono ${ACTOR_STYLES[t.actor] ?? 'text-zinc-500'}`}>
              {t.actor.toLowerCase()}
            </span>
            {t.reason && <span class="text-zinc-400"> — {t.reason}</span>}
          </p>
        </li>
      ))}
    </ol>
  );
}
