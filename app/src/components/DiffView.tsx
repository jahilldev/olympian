import { useState, useEffect } from 'preact/hooks';

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-green-400';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-red-400';
  if (line.startsWith('@@')) return 'text-cyan-400';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'))
    return 'text-zinc-500';
  return 'text-zinc-300';
}

/** Fetches and renders the unified diff of a job's branch vs base (dashboard result view). */
export default function DiffView({ jobId }: { jobId: string }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/${jobId}/diff`)
      .then((r) => (r.ok ? (r.json() as Promise<{ diff: string }>) : Promise.reject(r.status)))
      .then(({ diff: d }) => {
        if (!cancelled) setDiff(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (error) return <p class="text-xs text-red-400 font-mono">Failed to load diff.</p>;
  if (diff === null) return <p class="text-xs text-zinc-600 font-mono italic">Loading diff…</p>;
  if (diff.trim().length === 0)
    return <p class="text-xs text-zinc-600 italic">No changes on the branch yet.</p>;

  return (
    <pre class="overflow-x-auto rounded-lg border border-zinc-800 bg-black p-4 text-xs font-mono leading-relaxed">
      {diff.split('\n').map((line, i) => (
        <div key={i} class={lineClass(line)}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}
