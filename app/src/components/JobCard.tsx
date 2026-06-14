import type { JobSummaryDto } from "@olympian/api/interface/interface.model.js";
import { navigate } from "./App.tsx";
import StateBadge from "./StateBadge.tsx";

interface Props {
  job: JobSummaryDto;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function confidenceColour(v: number): string {
  if (v >= 85) return "text-green-400";
  if (v >= 70) return "text-amber-400";
  return "text-red-400";
}

export default function JobCard({ job }: Props) {
  const title =
    job.issueTitle.length > 80
      ? job.issueTitle.slice(0, 79) + "…"
      : job.issueTitle;

  return (
    <tr
      class="border-b border-zinc-800 hover:bg-zinc-900/60 cursor-pointer transition-colors"
      onClick={() => navigate(`/jobs/${job.id}`)}
    >
      <td class="py-3 px-4 whitespace-nowrap">
        <StateBadge state={job.state} />
      </td>
      <td class="py-3 px-4 max-w-sm">
        <div class="flex flex-col gap-0.5">
          <span class="text-sm text-zinc-200 truncate">{title}</span>
          <a
            href={`https://github.com/${job.repoFullName}/issues/${job.issueNumber}`}
            class="text-xs text-zinc-500 hover:text-zinc-400"
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {job.repoFullName} #{job.issueNumber}
          </a>
        </div>
      </td>
      <td class="py-3 px-4 whitespace-nowrap">
        {job.prNumber ? (
          <a
            href={job.prUrl ?? "#"}
            class={`text-xs font-mono hover:underline ${job.prIsDraft ? "text-zinc-500" : "text-sky-400"}`}
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noopener noreferrer"
          >
            #{job.prNumber}
            {job.prIsDraft && " (draft)"}
          </a>
        ) : (
          <span class="text-zinc-700">—</span>
        )}
      </td>
      <td class="py-3 px-4 whitespace-nowrap">
        {job.activeRun ? (
          <span class="flex items-center gap-1.5 text-xs text-green-400 font-mono">
            <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {job.activeRun.phase}
          </span>
        ) : (
          <span class="text-zinc-700">—</span>
        )}
      </td>
      <td class="py-3 px-4 whitespace-nowrap">
        {job.confidence !== null ? (
          <span
            class={`text-xs font-mono tabular-nums ${confidenceColour(job.confidence)}`}
          >
            {job.confidence}%
          </span>
        ) : (
          <span class="text-zinc-700">—</span>
        )}
      </td>
      <td class="py-3 px-4 whitespace-nowrap">
        {job.reviewCycle > 0 ? (
          <span class="text-xs text-zinc-400">cycle {job.reviewCycle}</span>
        ) : (
          <span class="text-zinc-700">—</span>
        )}
      </td>
      <td class="py-3 px-4 whitespace-nowrap text-xs text-zinc-500">
        {relativeTime(job.updatedAt)}
      </td>
    </tr>
  );
}
