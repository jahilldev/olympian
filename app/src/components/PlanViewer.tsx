import type { PlanRevisionDto } from "@olympian/api/interface/interface.model.js";

interface Props {
  plan: PlanRevisionDto;
}

export default function PlanViewer({ plan }: Props) {
  return (
    <div class="space-y-2">
      <div class="flex items-center gap-2 text-xs text-zinc-500">
        <span>Revision {plan.revision}</span>
        <span>·</span>
        <span
          class={`px-1.5 py-0.5 rounded font-mono ${
            plan.status === "APPROVED"
              ? "bg-green-900/50 text-green-400"
              : plan.status === "REJECTED"
                ? "bg-red-900/50 text-red-400"
                : "bg-zinc-700 text-zinc-400"
          }`}
        >
          {plan.status}
        </span>
      </div>
      <pre class="font-mono text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-900 rounded-lg border border-zinc-800 p-4 overflow-x-auto">
        {plan.content}
      </pre>
    </div>
  );
}
