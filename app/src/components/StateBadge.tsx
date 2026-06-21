const STATE_STYLES: Record<string, string> = {
  TRIAGED: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  PLANNING: 'bg-blue-950 text-blue-300 border border-blue-800',
  AWAITING_PLAN_APPROVAL: 'bg-amber-950 text-amber-300 border border-amber-800',
  IMPLEMENTING: 'bg-sky-950 text-sky-300 border border-sky-800',
  VERIFYING: 'bg-teal-950 text-teal-300 border border-teal-800',
  SELF_REVIEWING: 'bg-violet-950 text-violet-300 border border-violet-800',
  REVISING: 'bg-sky-950 text-sky-300 border border-sky-800',
  OPENING_PR: 'bg-indigo-950 text-indigo-300 border border-indigo-800',
  AWAITING_PR_APPROVAL: 'bg-amber-950 text-amber-300 border border-amber-800',
  DONE: 'bg-green-950 text-green-300 border border-green-800',
  FAILED: 'bg-red-950 text-red-400 border border-red-900',
  CANCELLED: 'bg-zinc-900 text-zinc-500 border border-zinc-800',
};

const STATE_LABELS: Record<string, string> = {
  TRIAGED: 'triaged',
  PLANNING: 'planning',
  AWAITING_PLAN_APPROVAL: 'plan review',
  IMPLEMENTING: 'implementing',
  VERIFYING: 'verifying',
  SELF_REVIEWING: 'reviewing',
  REVISING: 'revising',
  OPENING_PR: 'opening pr',
  AWAITING_PR_APPROVAL: 'pr review',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

interface Props {
  state: string;
}

export default function StateBadge({ state }: Props) {
  const cls = STATE_STYLES[state] ?? 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  const label = STATE_LABELS[state] ?? state.toLowerCase().replace(/_/g, ' ');
  return (
    <span
      class={`inline-block px-2 py-0.5 rounded-md text-xs font-medium font-mono whitespace-nowrap uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}
