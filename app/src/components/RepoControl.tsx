import { useState } from 'preact/hooks';
import { shortRepoUrl } from '../utils/job.ts';

const SSH_REMOTE_REGEX = /^(?:[^@\s]+@[^:\s]+:.+|ssh:\/\/.+)$/;

/**
 * Shows a dashboard job's working repo and, while still editable (up to plan approval),
 * lets the user set/replace/clear it. Empty = scratch (greenfield) workspace.
 */
export default function RepoControl({
  jobId,
  repoUrl,
  editable,
  onSaved,
}: {
  jobId: string;
  repoUrl: string | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(repoUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = value.trim().length > 0 && !SSH_REMOTE_REGEX.test(value.trim());

  async function save() {
    if (invalid) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/repo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: value.trim() }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(b.message) ? b.message.join(', ') : b.message;
        setError(msg ?? `Could not update repo (${res.status})`);
        return;
      }
      setEditing(false);
      onSaved();
    } catch {
      setError('Could not update repo — network error');
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div class="flex items-center gap-2 text-xs">
        <span class="text-zinc-500">Repo:</span>
        <span class="font-mono text-zinc-300">
          {repoUrl ? shortRepoUrl(repoUrl) : 'scratch (no repo)'}
        </span>
        {editable && (
          <button
            onClick={() => {
              setValue(repoUrl ?? '');
              setEditing(true);
            }}
            class="text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {repoUrl ? 'change' : 'set'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div class="space-y-1.5">
      <div class="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          placeholder="git@github.com:owner/repo.git (empty = scratch)"
          class={`flex-1 rounded-lg bg-zinc-900 border px-2.5 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none ${
            invalid ? 'border-red-700' : 'border-zinc-800 focus:border-indigo-600'
          }`}
        />
        <button
          disabled={pending || invalid}
          onClick={() => void save()}
          class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Cancel
        </button>
      </div>
      {invalid && <p class="text-xs text-red-400">Must be an SSH remote, or empty for scratch.</p>}
      {error && <p class="text-xs text-red-400">{error}</p>}
    </div>
  );
}
