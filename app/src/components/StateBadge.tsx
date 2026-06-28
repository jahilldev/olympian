// Palette: active/in-progress stages → cyan; awaiting-human → amber; terminal success/failure →
// green/red; idle/cancelled → zinc. The label text names the specific stage, so colour only needs
// to convey the broad category.
const ACTIVE = 'bg-cyan-950 text-cyan-300 border border-cyan-800';
const AWAITING = 'bg-amber-950 text-amber-300 border border-amber-800';

const STATE_STYLES: Record<string, string> = {
  TRIAGED: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
  PLANNING: ACTIVE,
  AWAITING_PLAN_APPROVAL: AWAITING,
  IMPLEMENTING: ACTIVE,
  VERIFYING: ACTIVE,
  SELF_REVIEWING: ACTIVE,
  REVISING: ACTIVE,
  OPENING_PR: ACTIVE,
  AWAITING_PR_APPROVAL: AWAITING,
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
