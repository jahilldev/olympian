import { useState } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { navigate } from '../utils/navigate.ts';

const SSH_REMOTE_REGEX = /^(?:[^@\s]+@[^:\s]+:.+|ssh:\/\/.+)$/;

const PROSE =
  'prose prose-sm prose-invert max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-a:text-cyan-400 prose-strong:text-zinc-200 prose-code:text-amber-300 prose-code:bg-zinc-900 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-900 prose-pre:text-zinc-300 [&_pre_code]:text-zinc-300 prose-pre:border prose-pre:border-zinc-800 prose-li:text-zinc-300';

export default function CreateJob() {
  const [title, setTitle] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [requirements, setRequirements] = useState('');
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoInvalid = repoUrl.trim().length > 0 && !SSH_REMOTE_REGEX.test(repoUrl.trim());
  const canSubmit =
    title.trim().length > 0 && requirements.trim().length > 0 && !repoInvalid && !submitting;

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          requirements: requirements.trim(),
          ...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        setError(msg ?? `Could not create job (${res.status})`);
        setSubmitting(false);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      navigate(`/jobs/${id}`);
    } catch {
      setError('Could not create job — network error');
      setSubmitting(false);
    }
  }

  const previewHtml = DOMPurify.sanitize(
    marked.parse(requirements || '_Nothing to preview yet._') as string,
  );

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="shrink-0 flex items-center gap-2 px-4 h-14 border-b border-zinc-800 bg-zinc-950">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate('/')}
        >
          ← Back
        </button>
        <span class="text-zinc-700 text-sm">/</span>
        <span class="text-xs text-zinc-400 font-medium">New job</span>
      </header>

      <div class="flex-1 overflow-y-auto">
        <form class="max-w-3xl mx-auto px-4 py-6 space-y-5" onSubmit={submit}>
          <div class="space-y-1.5">
            <label class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Title</label>
            <input
              type="text"
              value={title}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              placeholder="Short summary of the work"
              class="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Repo (SSH, optional)
            </label>
            <input
              type="text"
              value={repoUrl}
              onInput={(e) => setRepoUrl((e.target as HTMLInputElement).value)}
              placeholder="git@github.com:owner/repo.git — leave empty for a scratch workspace"
              class={`w-full rounded-lg bg-zinc-900 border px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none ${
                repoInvalid ? 'border-red-700 focus:border-red-600' : 'border-zinc-800 focus:border-cyan-600'
              }`}
            />
            {repoInvalid && (
              <p class="text-xs text-red-400">
                Must be an SSH remote (git@host:path or ssh://…). You can also set or change it later.
              </p>
            )}
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Requirements (Markdown)
              </label>
              <button
                type="button"
                onClick={() => setPreview((p) => !p)}
                class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {preview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {preview ? (
              <div
                class={`min-h-[16rem] rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-3 ${PROSE}`}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <textarea
                value={requirements}
                onInput={(e) => setRequirements((e.target as HTMLTextAreaElement).value)}
                placeholder="Describe the work like a GitHub issue — context, goals, acceptance criteria…"
                rows={14}
                class="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-600 resize-y"
              />
            )}
          </div>

          {error && <p class="text-sm text-red-400">{error}</p>}

          <div class="flex items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              class="rounded-lg bg-hermes-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-hermes-500 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating…' : 'Create & plan'}
            </button>
            <span class="text-xs text-zinc-600">Hermes will draft a plan for your approval.</span>
          </div>
        </form>
      </div>
    </div>
  );
}
