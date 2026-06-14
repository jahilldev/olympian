const STATE_STYLES: Record<string, string> = {
  TRIAGED: 'bg-zinc-700 text-zinc-200',
  PLANNING: 'bg-blue-900 text-blue-200',
  AWAITING_PLAN_APPROVAL: 'bg-amber-900 text-amber-200',
  IMPLEMENTING: 'bg-indigo-900 text-indigo-200',
  TESTING: 'bg-cyan-900 text-cyan-200',
  SELF_REVIEWING: 'bg-violet-900 text-violet-200',
  REVISING: 'bg-orange-900 text-orange-200',
  OPENING_PR: 'bg-sky-900 text-sky-200',
  AWAITING_PR_APPROVAL: 'bg-amber-900 text-amber-200',
  DONE: 'bg-green-900 text-green-200',
  FAILED: 'bg-red-900 text-red-200',
  CANCELLED: 'bg-zinc-700 text-zinc-400',
};

interface Props {
  state: string;
}

export default function StateBadge({ state }: Props) {
  const cls = STATE_STYLES[state] ?? 'bg-zinc-700 text-zinc-300';
  return (
    <span class={`inline-block px-2 py-0.5 rounded text-xs font-medium font-mono ${cls}`}>
      {state}
    </span>
  );
}
