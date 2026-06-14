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

  return (
    <ol class="relative border-l border-zinc-800 space-y-4 pl-4">
      {[...transitions].reverse().map((t) => (
        <li key={t.id} class="relative">
          <span class="absolute -left-[21px] flex items-center justify-center w-3.5 h-3.5 rounded-full bg-zinc-800 border border-zinc-700 mt-0.5" />
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <StateBadge state={t.toState} />
            {t.reason && <span class="text-zinc-400">{t.reason}</span>}
            <span class={`font-mono ${ACTOR_STYLES[t.actor] ?? 'text-zinc-500'}`}>{t.actor}</span>
            <span class="text-zinc-600 ml-auto">{relativeTime(t.createdAt)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
