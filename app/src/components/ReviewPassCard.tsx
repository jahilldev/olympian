import type { ReviewPassDto } from '@olympian/api/review/review.model.js';
import ConfidenceGauge from './ConfidenceGauge.tsx';

interface Props {
  pass: ReviewPassDto;
}

const SEVERITY_STYLES = {
  low: 'bg-zinc-700 text-zinc-300',
  medium: 'bg-amber-900 text-amber-300',
  high: 'bg-orange-900 text-orange-300',
  critical: 'bg-red-900 text-red-300',
};

export default function ReviewPassCard({ pass }: Props) {
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-zinc-200">Pass {pass.passNumber}</span>
        <span
          class={`text-xs font-mono px-2 py-0.5 rounded font-medium ${
            pass.verdict === 'PASS' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
          }`}
        >
          {pass.verdict}
        </span>
      </div>

      <ConfidenceGauge value={pass.confidence} />

      {pass.issues.length > 0 && (
        <div class="space-y-2 pt-1">
          {pass.issues.map((issue, i) => (
            <div key={i} class="rounded border border-zinc-700 bg-zinc-800/50 p-3 space-y-1">
              <div class="flex items-center gap-2">
                <span
                  class={`text-xs font-mono px-1.5 py-0.5 rounded ${SEVERITY_STYLES[issue.severity] ?? SEVERITY_STYLES.medium}`}
                >
                  {issue.severity}
                </span>
                <span class="text-sm font-medium text-zinc-200">{issue.title}</span>
              </div>
              <p class="text-xs text-zinc-400 leading-relaxed">{issue.detail}</p>
              {issue.file && <p class="text-xs text-zinc-500 font-mono">{issue.file}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
