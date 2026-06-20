export function fmtTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function statusDot(status: string) {
  if (status === 'CONNECTING')
    return <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />;
  if (status === 'RUNNING')
    return <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />;
  if (status === 'SUCCEEDED') return <span class="text-green-400 text-sm">✓</span>;
  if (status === 'FAILED') return <span class="text-red-400 text-sm">✗</span>;
  return <span class="text-zinc-500 text-sm">—</span>;
}

/** Strip ANSI escape codes so raw terminal output renders cleanly. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/** Peel <think>…</think> off the front of a model completion. */
export function splitThinking(text: string): { thinking: string | null; output: string } {
  const m = text.match(/^<think>([\s\S]*?)<\/think>\s*/);
  if (!m) return { thinking: null, output: text.trim() };
  return { thinking: m[1].trim(), output: text.slice(m[0].length).trim() };
}
