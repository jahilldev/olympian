interface Props {
  value: number;
}

function colourClass(v: number): string {
  if (v >= 85) return "bg-green-500";
  if (v >= 70) return "bg-amber-500";
  return "bg-red-500";
}

export default function ConfidenceGauge({ value }: Props) {
  return (
    <div class="flex items-center gap-2">
      <div class="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          class={`h-full rounded-full transition-all ${colourClass(value)}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span
        class={`text-xs font-mono tabular-nums ${value >= 85 ? "text-green-400" : value >= 70 ? "text-amber-400" : "text-red-400"}`}
      >
        {value}%
      </span>
    </div>
  );
}
