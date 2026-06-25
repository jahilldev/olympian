import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { LangfuseEvent, StreamPayload } from '@olympian/api/langfuse/langfuse.model.js';
import type { ChatSessionDetailDto } from '@olympian/api/chat/chat.model.js';
import { navigate } from '../utils/navigate.ts';
import { shortRepoUrl } from '../utils/job.ts';
import Markdown from './Markdown.tsx';
import { EventCard } from './RunOutput/EventCard.tsx';

export default function Chat() {
  const id = window.location.pathname.split('/')[2] ?? '';
  const [session, setSession] = useState<ChatSessionDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<LangfuseEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) setSession((await res.json()) as ChatSessionDetailDto);
    } catch {
      // keep polling
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    // Poll while idle so a completed assistant message appears; the SSE stream covers live activity.
    const timer = setInterval(() => {
      if (!activeRunId) void refresh();
    }, 3_000);
    return () => clearInterval(timer);
  }, [refresh, activeRunId]);

  // Live stream the active run's agent activity via the shared SSE pipeline.
  useEffect(() => {
    if (!activeRunId) return;
    const es = new EventSource(`/stream/runs/${activeRunId}`);
    es.onmessage = (e) => {
      const payload = JSON.parse(e.data as string) as StreamPayload;
      if (payload.type === 'history') setLiveEvents(payload.events);
      else if (payload.type === 'event') setLiveEvents((prev) => [...prev, payload.event]);
      else if (payload.type === 'done' || payload.type === 'error') {
        es.close();
        setActiveRunId(null);
        setLiveEvents([]);
        void refresh();
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setActiveRunId(null);
        setLiveEvents([]);
        void refresh();
      }
    };
    return () => es.close();
  }, [activeRunId, refresh]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.messages.length, liveEvents.length]);

  const orderedEvents = [...liveEvents].sort((a, b) =>
    a.timestamp === b.timestamp ? 0 : a.timestamp < b.timestamp ? -1 : 1,
  );

  async function send(e: Event) {
    e.preventDefault();
    const content = input.trim();
    if (content.length === 0 || sending || activeRunId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(b.message) ? b.message.join(', ') : b.message;
        setError(msg ?? `Could not send (${res.status})`);
        return;
      }
      const { runId } = (await res.json()) as { runId: string };
      setInput('');
      await refresh(); // show the just-sent user message
      setActiveRunId(runId);
    } catch {
      setError('Could not send — network error');
    } finally {
      setSending(false);
    }
  }

  if (notFound) {
    return (
      <div class="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
        <p class="text-base">Chat not found</p>
        <button class="text-sm text-indigo-400 hover:text-indigo-300" onClick={() => navigate('/')}>
          Back to all jobs
        </button>
      </div>
    );
  }

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate('/')}
        >
          ← Back
        </button>
        <span class="text-zinc-700 text-sm">/</span>
        <span class="text-xs text-zinc-300 font-medium truncate">{session?.title ?? 'Chat'}</span>
        {session?.repoUrl && (
          <span class="ml-auto text-xs font-mono text-zinc-600 truncate">
            {shortRepoUrl(session.repoUrl)}
          </span>
        )}
      </header>

      <div ref={scrollRef} class="flex-1 overflow-y-auto">
        <div class="max-w-3xl mx-auto px-4 py-5 space-y-4">
          {session === null ? (
            <div class="flex justify-center py-10">
              <div class="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : session.messages.length === 0 && !activeRunId ? (
            <p class="text-center text-sm text-zinc-600 py-10">
              Ask Hermes anything — research, questions, or general work.
            </p>
          ) : (
            session.messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} class="flex justify-end">
                  <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600/90 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} class="flex flex-col gap-1">
                  <div class="rounded-2xl rounded-bl-sm bg-zinc-900 border border-zinc-800 px-4 py-3">
                    <Markdown text={m.content} />
                  </div>
                </div>
              ),
            )
          )}

          {/* Live activity for the in-flight assistant turn */}
          {activeRunId && (
            <div class="rounded-2xl rounded-bl-sm bg-zinc-900 border border-zinc-800 px-4 py-3 font-mono text-sm space-y-3">
              <p class="flex items-center gap-2 text-cyan-400 text-xs">
                <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Hermes is working…
              </p>
              {orderedEvents.map((ev, i) => (
                <EventCard key={i} event={ev} />
              ))}
            </div>
          )}
        </div>
      </div>

      <form
        class="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3"
        onSubmit={send}
      >
        <div class="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            value={input}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(e);
              }
            }}
            placeholder={activeRunId ? 'Hermes is responding…' : 'Message Hermes…'}
            rows={1}
            disabled={!!activeRunId}
            class="flex-1 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-600 resize-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || !!activeRunId || input.trim().length === 0}
            class="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </div>
        {error && <p class="max-w-3xl mx-auto text-xs text-red-400 pt-2">{error}</p>}
      </form>
    </div>
  );
}
