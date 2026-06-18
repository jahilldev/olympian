import { useState } from 'preact/hooks';
import type { VerifyRunDto } from '@olympian/api/verify/verify.model.js';

interface Props {
  run: VerifyRunDto;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export default function VerifyRunRow({ run }: Props) {
  const [open, setOpen] = useState(false);
  const hasOutput = run.output.trim().length > 0;

  return (
    <div
      class={`rounded-lg border p-3 ${
        run.ok ? 'border-teal-900 bg-teal-950/20' : 'border-red-900 bg-red-950/20'
      }`}
    >
      <div class="flex items-center gap-2.5">
        <span
          class={`font-mono text-xs px-2.5 py-1 rounded shrink-0 ${
            run.ok ? 'bg-teal-900/60 text-teal-300' : 'bg-red-900/60 text-red-300'
          }`}
        >
          VERIFY
        </span>
        <span class={`text-xs font-medium ${run.ok ? 'text-teal-400' : 'text-red-400'}`}>
          {run.ok ? '✓ passed' : '✗ failed'}
        </span>
        <span class="text-xs text-zinc-600">attempt {run.attempt}</span>
        <span class="ml-auto text-xs text-zinc-600 shrink-0">{formatDuration(run.durationMs)}</span>
      </div>

      <code class="block mt-2 text-xs text-zinc-400 font-mono break-all">{run.command}</code>

      {hasOutput && (
        <button
          class="mt-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▾ hide output' : '▸ show output'}
        </button>
      )}
      {open && hasOutput && (
        <pre class="mt-2 text-xs text-zinc-400 font-mono whitespace-pre-wrap overflow-x-auto max-h-80 overflow-y-auto bg-zinc-950 rounded p-2 border border-zinc-800">
          {run.output}
        </pre>
      )}
    </div>
  );
}
