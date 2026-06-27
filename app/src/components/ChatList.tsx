import { useState, useEffect } from 'preact/hooks';
import type { ChatSessionSummaryDto } from '@olympian/api/chat/chat.model.js';
import { navigate } from '../utils/navigate.ts';
import { shortRepoUrl } from '../utils/job.ts';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ChatList() {
  const [sessions, setSessions] = useState<ChatSessionSummaryDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/chats');
        if (res.ok && !cancelled) setSessions((await res.json()) as ChatSessionSummaryDto[]);
      } catch {
        if (!cancelled) setSessions([]);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function newChat() {
    setCreating(true);
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const { id } = (await res.json()) as { id: string };
        navigate(`/chats/${id}`);
        return;
      }
    } catch {
      // fall through
    }
    setCreating(false);
  }

  async function deleteChat(id: string) {
    if (!confirm('Delete this chat and all of its messages? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
      }
    } catch {
      // leave the row in place; the next poll will reconcile
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="shrink-0 flex items-center gap-3 px-4 sm:px-6 h-14 border-b border-zinc-800">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate('/')}
        >
          ← Back
        </button>
        <span class="text-zinc-700 text-sm">/</span>
        <span class="text-sm font-medium text-zinc-200">Chats</span>
        <button
          disabled={creating}
          onClick={() => void newChat()}
          class="ml-auto rounded-lg bg-hermes-400 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-hermes-500 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Starting…' : 'New chat'}
        </button>
      </header>

      <div class="flex-1 overflow-y-auto">
        {sessions === null ? (
          <div class="flex justify-center py-16">
            <div class="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <p class="text-center text-sm text-zinc-600 py-16 px-4">
            No chats yet. Start one with <span class="text-zinc-400">New chat</span>.
          </p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              class="group border-b border-zinc-800/60 hover:bg-zinc-900/60 transition-colors flex items-center"
            >
              <button
                onClick={() => navigate(`/chats/${s.id}`)}
                class="flex-1 min-w-0 text-left pl-4 sm:pl-6 py-4 flex items-center gap-3"
              >
                <div class="flex-1 min-w-0 space-y-1">
                  <p class="text-sm font-medium text-zinc-100 truncate">{s.title}</p>
                  <div class="flex items-center gap-2 text-xs text-zinc-500">
                    <span>
                      {s.messageCount} {s.messageCount === 1 ? 'message' : 'messages'}
                    </span>
                    {s.repoUrl && (
                      <span class="font-mono text-zinc-600 truncate">{shortRepoUrl(s.repoUrl)}</span>
                    )}
                    <span class="ml-auto whitespace-nowrap">{relativeTime(s.updatedAt)}</span>
                  </div>
                </div>
                <svg
                  class="w-4 h-4 text-zinc-700 shrink-0"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </button>
              <button
                disabled={deletingId === s.id}
                onClick={() => void deleteChat(s.id)}
                aria-label="Delete chat"
                title="Delete chat"
                class="shrink-0 self-stretch px-3 sm:px-4 text-zinc-600 hover:text-red-400 disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                {deletingId === s.id ? (
                  <span class="block w-4 h-4 border-2 border-zinc-700 border-t-red-400 rounded-full animate-spin" />
                ) : (
                  <svg
                    class="w-4 h-4"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9a1 1 0 001 1h3a1 1 0 001-1l.5-9M6.5 7v4M9.5 7v4" />
                  </svg>
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
