import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { LangfuseEvent, StreamPayload } from '@olympian/api/langfuse/langfuse.model.js';
import type { AgentRunOutputDto } from '@olympian/api/agent/agent.model.js';
import { navigate } from '../utils/navigate.ts';

interface RunMeta {
  phase: string;
  model: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
}

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT']);

function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function statusDot(status: string) {
  if (status === 'RUNNING')
    return <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />;
  if (status === 'SUCCEEDED') return <span class="text-green-400 text-sm">✓</span>;
  if (status === 'FAILED') return <span class="text-red-400 text-sm">✗</span>;
  return <span class="text-zinc-500 text-sm">—</span>;
}

/** Strip ANSI escape codes so raw terminal output renders cleanly. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

// ── Icons ─────────────────────────────────────────────────────────────────

function IconBrain() {
  return (
    <svg
      class="w-3.5 h-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.96-3 2.5 2.5 0 0 1-1.32-4.24 3 3 0 0 1 .34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.96-3 2.5 2.5 0 0 0 1.32-4.24 3 3 0 0 0-.34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2" />
    </svg>
  );
}

function IconWrench() {
  return (
    <svg
      class="w-3.5 h-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      class={`w-3 h-3 shrink-0 transition-transform duration-150${open ? ' rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Peel <think>…</think> off the front of a model completion. */
function splitThinking(text: string): { thinking: string | null; output: string } {
  const m = text.match(/^<think>([\s\S]*?)<\/think>\s*/);
  if (!m) return { thinking: null, output: text.trim() };
  return { thinking: m[1].trim(), output: text.slice(m[0].length).trim() };
}

// ── Data types ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: string;
  content: unknown;
}
interface TodoItem {
  id: string | number;
  content: string;
  status: string;
}
interface LlmToolCall {
  name?: string;
  arguments?: string;
  function?: { name?: string; arguments?: string };
}

function isChatMessages(v: unknown): v is ChatMessage[] {
  return (
    Array.isArray(v) && v.length > 0 && typeof (v[0] as Record<string, unknown>)?.role === 'string'
  );
}
function isTodoList(v: unknown): v is TodoItem[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v[0] as Record<string, unknown>)?.content === 'string' &&
    'status' in (v[0] as object)
  );
}
function parseObs(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
function isDiff(text: string): boolean {
  return /^[-+]{3} |^@@/m.test(text);
}

// ── Observation value renderers ────────────────────────────────────────────

function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  const roleStyle: Record<string, string> = {
    system: 'text-zinc-600',
    user: 'text-sky-400',
    assistant: 'text-indigo-300',
    tool: 'text-amber-400',
  };
  return (
    <div class="divide-y divide-zinc-800/50">
      {messages.map((m, i) => {
        const content =
          typeof m.content === 'string'
            ? m.content
            : m.content == null
              ? ''
              : JSON.stringify(m.content, null, 2);
        if (!content) return null;
        return (
          <div key={i} class="py-2 flex gap-2.5 min-w-0">
            <span
              class={`shrink-0 text-[10px] font-mono uppercase font-semibold w-14 text-right pt-px ${roleStyle[m.role] ?? 'text-zinc-500'}`}
            >
              {m.role}
            </span>
            <pre class="flex-1 min-w-0 text-[11px] text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed break-words">
              {content}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// ── Diff renderer ─────────────────────────────────────────────────────────

function DiffView({ text }: { text: string }) {
  return (
    <div class="font-mono text-[11px] leading-relaxed overflow-x-auto rounded-md overflow-hidden">
      {text.split('\n').map((line, i) => {
        const isAdd = line.startsWith('+') && !line.startsWith('+++');
        const isDel = line.startsWith('-') && !line.startsWith('---');
        const isHunk = line.startsWith('@@');
        const isHeader = line.startsWith('+++') || line.startsWith('---');
        return (
          <div
            key={i}
            class={`px-2 ${isAdd ? 'bg-green-950/40' : isDel ? 'bg-red-950/40' : isHunk ? 'bg-indigo-950/30' : ''}`}
          >
            <span
              class={
                isAdd
                  ? 'text-green-300'
                  : isDel
                    ? 'text-red-300'
                    : isHunk
                      ? 'text-indigo-400'
                      : isHeader
                        ? 'text-zinc-400 font-semibold'
                        : 'text-zinc-500'
              }
            >
              {line || '\u00a0'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Terminal renderer ─────────────────────────────────────────────────────

function TerminalInput({ command, workdir }: { command: string; workdir?: string }) {
  return (
    <div class="rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800">
      {workdir && (
        <div class="px-3 py-1 text-[10px] font-mono text-zinc-600 border-b border-zinc-800 truncate">
          {workdir}
        </div>
      )}
      <div class="px-3 py-2.5 flex gap-2 items-start">
        <span class="text-green-500 font-mono text-[12px] shrink-0 select-none leading-relaxed">
          $
        </span>
        <pre class="text-[11px] font-mono text-zinc-100 whitespace-pre-wrap break-words flex-1 min-w-0 leading-relaxed">
          {command}
        </pre>
      </div>
    </div>
  );
}

function TerminalOutput({
  output,
  exitCode,
  error,
}: {
  output: string;
  exitCode?: number | null;
  error?: string | null;
}) {
  const success = exitCode === 0 || exitCode == null;
  const cleaned = stripAnsi(output).trim();
  return (
    <div class="rounded-lg overflow-hidden bg-zinc-950 border border-zinc-800">
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/80">
        <span class="text-[10px] font-mono text-zinc-700">stdout</span>
        {exitCode != null && (
          <span
            class={`text-[10px] font-mono font-semibold ${success ? 'text-green-500' : 'text-red-400'}`}
          >
            exit {exitCode}
          </span>
        )}
      </div>
      <pre class="px-3 py-2.5 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed break-words max-h-72 overflow-y-auto">
        {cleaned || <span class="text-zinc-700 italic">no output</span>}
      </pre>
      {error && (
        <div class="border-t border-zinc-800/80 px-3 py-2">
          <pre class="text-[11px] font-mono text-red-400 whitespace-pre-wrap break-words">
            {error}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Todo renderer ─────────────────────────────────────────────────────────

const TODO_STATUS: Record<string, { icon: string; cls: string; textCls: string }> = {
  completed: { icon: '✓', cls: 'text-green-400', textCls: 'text-zinc-600 line-through' },
  in_progress: { icon: '◌', cls: 'text-amber-400', textCls: 'text-zinc-200' },
  pending: { icon: '○', cls: 'text-zinc-600', textCls: 'text-zinc-400' },
  cancelled: { icon: '×', cls: 'text-red-500', textCls: 'text-zinc-700 line-through' },
};

function TodoList({ items }: { items: TodoItem[] }) {
  return (
    <div class="space-y-0.5">
      {items.map((item, i) => {
        const s = TODO_STATUS[item.status] ?? TODO_STATUS.pending;
        return (
          <div key={i} class="flex items-start gap-2.5 py-1 min-w-0">
            <span class={`shrink-0 w-3.5 text-center text-[12px] leading-tight mt-px ${s.cls}`}>
              {s.icon}
            </span>
            <span
              class={`text-[11px] font-mono leading-snug flex-1 min-w-0 break-words ${s.textCls}`}
            >
              {item.content}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TodoSummary({ summary }: { summary: Record<string, number> }) {
  const stats = [
    { label: 'done', count: summary.completed ?? 0, cls: 'text-green-500' },
    { label: 'active', count: summary.in_progress ?? 0, cls: 'text-amber-400' },
    { label: 'pending', count: summary.pending ?? 0, cls: 'text-zinc-500' },
  ].filter((s) => s.count > 0);
  return (
    <div class="flex items-center gap-3 pt-2 mt-2 border-t border-zinc-800/60 flex-wrap">
      {stats.map((s) => (
        <span key={s.label} class={`text-[10px] font-mono font-semibold ${s.cls}`}>
          {s.count} {s.label}
        </span>
      ))}
      <span class="text-[10px] font-mono text-zinc-700 ml-auto">{summary.total ?? 0} total</span>
    </div>
  );
}

// ── Write file renderer ───────────────────────────────────────────────────

function FileOpResult({ data }: { data: Record<string, unknown> }) {
  const paths =
    (data.files_modified as string[] | undefined) ??
    (data.list as string[] | undefined) ??
    (data.resolved_path ? [data.resolved_path as string] : []);
  const bytes = data.bytes_written as number | undefined;
  const dirs = data.dirs_created as string[] | undefined;
  return (
    <div class="space-y-1.5">
      {paths.map((p) => (
        <div key={p} class="flex items-center gap-2 min-w-0">
          <span class="shrink-0 text-[10px] font-mono text-zinc-600">file</span>
          <span class="text-[11px] font-mono text-zinc-300 truncate flex-1 min-w-0">{p}</span>
        </div>
      ))}
      <div class="flex items-center gap-3 text-[10px] font-mono text-zinc-600 flex-wrap pt-0.5">
        {bytes != null && (
          <span>{bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`} written</span>
        )}
        {dirs && dirs.length > 0 && (
          <span>
            {dirs.length} dir{dirs.length > 1 ? 's' : ''} created
          </span>
        )}
      </div>
    </div>
  );
}

// ── LLM tool-call list ────────────────────────────────────────────────────

function LlmToolCallList({ calls }: { calls: LlmToolCall[] }) {
  return (
    <div class="space-y-1.5">
      {calls.map((call, i) => {
        const name = call.name ?? call.function?.name ?? 'unknown';
        const argsRaw = call.arguments ?? call.function?.arguments;
        let preview = '';
        if (argsRaw) {
          try {
            const args = JSON.parse(argsRaw) as Record<string, unknown>;
            const entries = Object.entries(args);
            if (entries.length === 1) {
              const [k, v] = entries[0];
              const val = Array.isArray(v)
                ? `${(v as unknown[]).length} items`
                : typeof v === 'string' && v.length > 50
                  ? v.slice(0, 47) + '…'
                  : String(v);
              preview = `${k}: ${val}`;
            } else {
              preview = entries.map(([k]) => k).join(', ');
            }
          } catch {
            preview = argsRaw.slice(0, 50);
          }
        }
        return (
          <div
            key={i}
            class="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-zinc-900 border border-zinc-800 min-w-0"
          >
            <span class="text-zinc-600 text-[10px] font-mono shrink-0">→</span>
            <span class="text-amber-300 text-[11px] font-mono font-semibold shrink-0">{name}</span>
            {preview && (
              <span class="text-zinc-600 text-[10px] font-mono truncate flex-1 min-w-0">
                ({preview})
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Generic key-value fallback ────────────────────────────────────────────

function KeyValueBlock({ obj }: { obj: Record<string, unknown> }) {
  return (
    <div class="space-y-2">
      {Object.entries(obj).map(([k, v]) => {
        if (isTodoList(v))
          return (
            <div key={k}>
              <TodoList items={v} />
            </div>
          );
        if (k === 'summary' && typeof v === 'object' && v !== null && 'total' in v) {
          return <TodoSummary key={k} summary={v as Record<string, number>} />;
        }
        const display =
          typeof v === 'string' ? v : v === null ? 'null' : JSON.stringify(v, null, 2);
        return (
          <div key={k} class="flex gap-2.5 min-w-0">
            <span class="shrink-0 text-[10px] font-mono text-zinc-600 w-16 text-right pt-0.5">
              {k}
            </span>
            <pre class="flex-1 min-w-0 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
              {display}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// ── Tool-name-aware input/output renderers ────────────────────────────────

function obsPreview(raw: string | undefined): string {
  const parsed = parseObs(raw);
  if (parsed === undefined) return '';
  if (typeof parsed === 'string') {
    const line = parsed.split('\n')[0].trim();
    return line.length > 80 ? line.slice(0, 77) + '…' : line;
  }
  if (isChatMessages(parsed)) return `${(parsed as unknown[]).length} messages`;
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.command === 'string')
      return obj.command.length > 80 ? obj.command.slice(0, 77) + '…' : obj.command;
    if (isTodoList(obj.todos)) return `${(obj.todos as unknown[]).length} todos`;
    if (typeof obj.path === 'string') return obj.path;
    if (typeof obj.output === 'string') {
      const line = obj.output.split('\n')[0].trim();
      return line.length > 80 ? line.slice(0, 77) + '…' : line;
    }
    if (Array.isArray((obj as Record<string, unknown>).tool_calls)) {
      return `${((obj as Record<string, unknown>).tool_calls as unknown[]).length} tool call(s)`;
    }
    return Object.keys(obj).join(', ');
  }
  if (Array.isArray(parsed)) return `${(parsed as unknown[]).length} items`;
  return String(parsed).slice(0, 80);
}

function ToolInputContent({ raw, toolName }: { raw: string | undefined; toolName: string }) {
  const parsed = parseObs(raw);
  if (parsed === undefined) return null;

  if (
    (toolName === 'terminal' || toolName === 'bash' || toolName === 'shell') &&
    typeof parsed === 'object' &&
    parsed !== null
  ) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.command === 'string')
      return (
        <TerminalInput
          command={obj.command}
          workdir={typeof obj.workdir === 'string' ? obj.workdir : undefined}
        />
      );
  }
  if (toolName === 'todo' && typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (isTodoList(obj.todos)) return <TodoList items={obj.todos} />;
  }
  if (
    (toolName === 'write_file' || toolName === 'write_files' || toolName === 'edit_file') &&
    typeof parsed === 'object' &&
    parsed !== null
  ) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.path === 'string') {
      return (
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-mono text-zinc-600 shrink-0">path</span>
            <span class="text-[11px] font-mono text-zinc-300 break-all">{obj.path}</span>
          </div>
          {typeof obj.content === 'string' && (
            <div class="max-h-64 overflow-y-auto rounded-md border border-zinc-800">
              {isDiff(obj.content) ? (
                <DiffView text={obj.content} />
              ) : (
                <pre class="px-3 py-2 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed break-words">
                  {obj.content}
                </pre>
              )}
            </div>
          )}
        </div>
      );
    }
  }
  // Generic fallback
  if (typeof parsed === 'string')
    return (
      <pre class="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap leading-relaxed break-words">
        {stripAnsi(parsed)}
      </pre>
    );
  if (isChatMessages(parsed)) return <ChatMessages messages={parsed} />;
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
    return <KeyValueBlock obj={parsed as Record<string, unknown>} />;
  if (isTodoList(parsed)) return <TodoList items={parsed} />;
  return (
    <pre class="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-words">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

function ToolOutputContent({ raw, toolName }: { raw: string | undefined; toolName: string }) {
  const parsed = parseObs(raw);
  if (parsed === undefined) return null;

  if (
    (toolName === 'terminal' || toolName === 'bash' || toolName === 'shell') &&
    typeof parsed === 'object' &&
    parsed !== null
  ) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.output === 'string')
      return (
        <TerminalOutput
          output={obj.output}
          exitCode={obj.exit_code as number | null}
          error={obj.error as string | null}
        />
      );
  }
  if (toolName === 'todo' && typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    return (
      <div>
        {isTodoList(obj.todos) && <TodoList items={obj.todos} />}
        {typeof obj.summary === 'object' && obj.summary !== null && (
          <TodoSummary summary={obj.summary as Record<string, number>} />
        )}
      </div>
    );
  }
  if (
    (toolName === 'write_file' || toolName === 'write_files' || toolName === 'edit_file') &&
    typeof parsed === 'object' &&
    parsed !== null
  ) {
    return <FileOpResult data={parsed as Record<string, unknown>} />;
  }
  // Generic fallback
  if (typeof parsed === 'string') {
    const s = stripAnsi(parsed);
    return isDiff(s) ? (
      <DiffView text={s} />
    ) : (
      <pre class="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed break-words max-h-72 overflow-y-auto">
        {s}
      </pre>
    );
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.output === 'string')
      return (
        <TerminalOutput
          output={obj.output}
          exitCode={obj.exit_code as number | null}
          error={obj.error as string | null}
        />
      );
    return <KeyValueBlock obj={obj} />;
  }
  if (isTodoList(parsed)) return <TodoList items={parsed} />;
  return (
    <pre class="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-words">
      {JSON.stringify(parsed, null, 2)}
    </pre>
  );
}

// ── Toggle row shared layout ──────────────────────────────────────────────

function SectionToggle({
  open,
  onToggle,
  label,
  preview,
  borderClass,
  labelClass,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  preview?: string;
  borderClass: string;
  labelClass?: string;
}) {
  return (
    <button
      class={`w-full flex items-center gap-2 px-3 min-h-[40px] text-[11px] font-mono text-zinc-600 hover:text-zinc-400 border-t ${borderClass} bg-zinc-950/60 transition-colors text-left overflow-hidden active:bg-zinc-900`}
      onClick={onToggle}
    >
      <IconChevron open={open} />
      <span class={`shrink-0 ${labelClass ?? ''}`}>{label}</span>
      {!open && preview && <span class="text-zinc-700 truncate flex-1 min-w-0">{preview}</span>}
    </button>
  );
}

// ── Event sub-cards ────────────────────────────────────────────────────────

function GenerationCard({ event }: { event: LangfuseEvent }) {
  const [inputOpen, setInputOpen] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const body = event.body;
  const model = body['langfuse.observation.model.name'] as string | undefined;
  const usageRaw = body['langfuse.observation.usage_details'] as string | undefined;
  const usage = usageRaw ? (JSON.parse(usageRaw) as Record<string, number>) : null;
  const totalTokens = usage?.total ?? usage?.output ?? null;
  const rawOutput = body['langfuse.observation.output'] as string | undefined;
  const rawInput = body['langfuse.observation.input'] as string | undefined;

  // SDK JSON-encodes the output — parse it first.
  const parsedOutput = parseObs(rawOutput);

  const isToolCallResponse =
    typeof parsedOutput === 'object' &&
    parsedOutput !== null &&
    !Array.isArray(parsedOutput) &&
    Array.isArray((parsedOutput as Record<string, unknown>).tool_calls);

  const toolCalls = isToolCallResponse
    ? ((parsedOutput as Record<string, unknown>).tool_calls as LlmToolCall[])
    : null;

  const llmText = isToolCallResponse
    ? (((parsedOutput as Record<string, unknown>).content as string | null | undefined) ?? '')
    : typeof parsedOutput === 'string'
      ? parsedOutput
      : typeof (parsedOutput as Record<string, unknown>)?.content === 'string'
        ? ((parsedOutput as Record<string, unknown>).content as string)
        : '';

  const { thinking, output } = llmText ? splitThinking(llmText) : { thinking: null, output: '' };

  return (
    <div class="rounded-xl border border-indigo-900/50 overflow-hidden text-xs shadow-sm">
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-indigo-950/50 text-indigo-200">
        <IconBrain />
        <span class="font-semibold font-mono tracking-wide">LLM</span>
        {model && (
          <span class="text-zinc-500 font-mono font-normal truncate flex-1 min-w-0">{model}</span>
        )}
        {totalTokens != null && (
          <span class="ml-auto shrink-0 text-zinc-600 font-mono text-[10px] tabular-nums">
            {totalTokens.toLocaleString()} tok
          </span>
        )}
      </div>

      {rawInput && (
        <>
          <SectionToggle
            open={inputOpen}
            onToggle={() => setInputOpen((o) => !o)}
            label="Input"
            preview={obsPreview(rawInput)}
            borderClass="border-indigo-900/30"
          />
          {inputOpen && (
            <div class="border-t border-zinc-800/40 px-3 py-3 bg-zinc-950/70 max-h-72 overflow-y-auto">
              {(() => {
                const p = parseObs(rawInput);
                if (isChatMessages(p)) return <ChatMessages messages={p} />;
                if (typeof p === 'string')
                  return (
                    <pre class="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words leading-relaxed">
                      {p}
                    </pre>
                  );
                return (
                  <pre class="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words">
                    {JSON.stringify(p, null, 2)}
                  </pre>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* Tool calls the LLM is invoking */}
      {toolCalls && toolCalls.length > 0 && (
        <div class="border-t border-indigo-900/30 px-3 py-2.5 bg-zinc-950/50">
          <LlmToolCallList calls={toolCalls} />
        </div>
      )}

      {/* Thinking */}
      {thinking && (
        <>
          <SectionToggle
            open={thinkOpen}
            onToggle={() => setThinkOpen((o) => !o)}
            label="Thinking"
            preview={`${thinking.split('\n').length} lines`}
            borderClass="border-indigo-900/30"
            labelClass="text-indigo-900/80"
          />
          {thinkOpen && (
            <div class="border-t border-zinc-800/40 px-3 py-2.5 bg-zinc-950/70 max-h-64 overflow-y-auto">
              <pre class="text-[11px] text-zinc-600 font-mono whitespace-pre-wrap leading-relaxed">
                {thinking}
              </pre>
            </div>
          )}
        </>
      )}

      {/* Response text */}
      {output && (
        <div class="border-t border-indigo-900/30 px-3 py-3 bg-black/15">
          <pre class="text-[12px] text-zinc-200 font-mono whitespace-pre-wrap leading-relaxed break-words">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolCard({ event }: { event: LangfuseEvent }) {
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const body = event.body;
  const name = String(body['langfuse.observation.name'] ?? body.name ?? 'unknown');
  const rawInput = body['langfuse.observation.input'] as string | undefined;
  const rawOutput = body['langfuse.observation.output'] as string | undefined;

  return (
    <div class="rounded-xl border border-amber-900/40 overflow-hidden text-xs shadow-sm">
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-amber-950/25 text-amber-200">
        <IconWrench />
        <span class="font-semibold font-mono tracking-wide">TOOL</span>
        <span class="text-zinc-300 font-mono font-medium">{name}</span>
      </div>

      {rawInput && (
        <>
          <SectionToggle
            open={inputOpen}
            onToggle={() => setInputOpen((o) => !o)}
            label="Input"
            preview={obsPreview(rawInput)}
            borderClass="border-amber-900/20"
          />
          {inputOpen && (
            <div class="border-t border-zinc-800/40 px-3 py-3 bg-zinc-950/70">
              <ToolInputContent raw={rawInput} toolName={name} />
            </div>
          )}
        </>
      )}

      {rawOutput && (
        <>
          <SectionToggle
            open={outputOpen}
            onToggle={() => setOutputOpen((o) => !o)}
            label="Output"
            preview={obsPreview(rawOutput)}
            borderClass="border-amber-900/20"
            labelClass="text-zinc-400"
          />
          {outputOpen && (
            <div class="border-t border-zinc-800/40 px-3 py-3 bg-zinc-950/50">
              <ToolOutputContent raw={rawOutput} toolName={name} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GenericSpanCard({ event }: { event: LangfuseEvent }) {
  const name = String(event.body['langfuse.observation.name'] ?? event.body.name ?? '');
  return (
    <div class="flex items-center gap-2 px-3 py-1 text-[11px] font-mono text-zinc-700 border-l border-zinc-800">
      <span class="w-1 h-1 rounded-full bg-zinc-700 shrink-0" />
      <span>{event.type}</span>
      {name && <span class="text-zinc-600">{name}</span>}
    </div>
  );
}

function EventCard({ event }: { event: LangfuseEvent }) {
  const obsType = event.body['langfuse.observation.type'] as string | undefined;
  if (obsType === 'generation') return <GenerationCard event={event} />;
  if (obsType === 'tool') return <ToolCard event={event} />;
  return <GenericSpanCard event={event} />;
}

// ---------------------------------------------------------------------------
// Static output view (completed runs)
// ---------------------------------------------------------------------------

function StaticOutput({
  jobId,
  runId,
  meta,
}: {
  jobId: string;
  runId: string;
  meta: RunMeta | null;
}) {
  const [output, setOutput] = useState<AgentRunOutputDto | null>(null);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/runs/${runId}/output`)
      .then((r) => (r.ok ? (r.json() as Promise<AgentRunOutputDto>) : Promise.reject(r.status)))
      .then(setOutput)
      .catch(() => setError(true));
  }, [runId]);

  const copy = useCallback(() => {
    if (output) void navigator.clipboard.writeText(output.stdout);
  }, [output]);

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          ← Job detail
        </button>
        <span class="text-zinc-700">/</span>
        {meta && (
          <>
            <span class="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
              {meta.phase}
            </span>
            {meta.model && <span class="text-xs text-zinc-500 truncate">{meta.model}</span>}
            <span class="flex items-center gap-1.5">{statusDot(meta.status)}</span>
            {meta.durationMs !== null && (
              <span class="text-xs text-zinc-500">{formatDuration(meta.durationMs)}</span>
            )}
          </>
        )}
        {output && (
          <button
            class="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={copy}
          >
            Copy
          </button>
        )}
      </header>

      <div ref={scrollRef} class="flex-1 overflow-y-auto bg-black px-5 py-4">
        {error && <p class="text-red-400 text-xs font-mono">Failed to load output.</p>}
        {!output && !error && <p class="text-zinc-700 text-xs font-mono italic">Loading…</p>}
        {output && (
          <pre class="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
            {stripAnsi(output.stdout) || (
              <span class="text-zinc-700 italic">No output recorded.</span>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live streaming view (in-flight runs)
// ---------------------------------------------------------------------------

function StreamingOutput({
  jobId,
  runId,
  meta,
  onMetaUpdate,
}: {
  jobId: string;
  runId: string;
  meta: RunMeta | null;
  onMetaUpdate: (m: RunMeta) => void;
}) {
  const [events, setEvents] = useState<LangfuseEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'done' | 'error'>(
    'connecting',
  );
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/stream/runs/${runId}`);

    es.onmessage = (e) => {
      const payload = JSON.parse(e.data as string) as StreamPayload;

      if (payload.type === 'history') {
        setEvents(payload.events);
        setStreamStatus('live');
      } else if (payload.type === 'event') {
        setEvents((prev) => [...prev, payload.event]);
      } else if (payload.type === 'done') {
        onMetaUpdate({
          phase: meta?.phase ?? '',
          model: meta?.model ?? null,
          status: payload.status,
          exitCode: payload.exitCode,
          durationMs: payload.durationMs,
        });
        setStreamStatus('done');
        es.close();
      } else if (payload.type === 'error') {
        setStreamStatus('error');
        es.close();
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreamStatus((s) => (s === 'live' ? 'done' : s));
      }
    };

    return () => es.close();
  }, [runId]);

  useEffect(() => {
    if (!pinnedToBottom || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, pinnedToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setPinnedToBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 50);
  }, []);

  const copy = useCallback(() => {
    const text = events
      .map((e) => `[${e.timestamp}] ${e.type}\n${JSON.stringify(e.body, null, 2)}`)
      .join('\n\n');
    void navigator.clipboard.writeText(text);
  }, [events]);

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <header class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
        <button
          class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => navigate(`/jobs/${jobId}`)}
        >
          ← Job detail
        </button>
        <span class="text-zinc-700">/</span>
        {meta && (
          <>
            <span class="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
              {meta.phase}
            </span>
            {meta.model && <span class="text-xs text-zinc-500 truncate">{meta.model}</span>}
            <span class="flex items-center gap-1.5">{statusDot(meta.status)}</span>
            {meta.durationMs !== null && (
              <span class="text-xs text-zinc-500">{formatDuration(meta.durationMs)}</span>
            )}
          </>
        )}
        {streamStatus === 'connecting' && (
          <span class="text-xs text-zinc-600 italic">connecting…</span>
        )}
        <button
          class="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={copy}
        >
          Copy
        </button>
      </header>

      <div class="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          class="h-full overflow-y-auto bg-black px-5 py-4 space-y-3 font-mono text-sm"
        >
          {events.length === 0 && streamStatus === 'live' && (
            <p class="text-zinc-700 italic text-xs">Waiting for agent activity…</p>
          )}
          {events.map((ev, i) => {
            const obsType = ev.body['langfuse.observation.type'] as string | undefined;
            const prevType =
              i > 0
                ? (events[i - 1].body['langfuse.observation.type'] as string | undefined)
                : undefined;
            const showDivider =
              obsType === 'generation' && prevType != null && prevType !== 'generation';
            return (
              <div key={i}>
                {showDivider && <hr class="border-zinc-800/60 my-1" />}
                <EventCard event={ev} />
              </div>
            );
          })}
          {streamStatus === 'done' && (
            <p class="text-zinc-600 text-xs pt-2 border-t border-zinc-900">Stream ended.</p>
          )}
          {streamStatus === 'error' && (
            <p class="text-red-500 text-xs pt-2">Stream error — run may not exist.</p>
          )}
        </div>
        {!pinnedToBottom && (
          <button
            class="absolute bottom-4 right-4 text-xs bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-full hover:bg-zinc-700 transition-colors"
            onClick={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                setPinnedToBottom(true);
              }
            }}
          >
            ↓ Latest
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component — fetches metadata and picks the right view
// ---------------------------------------------------------------------------

export default function RunOutput() {
  const parts = window.location.pathname.split('/');
  const jobId = parts[2] ?? '';
  const runId = parts[4] ?? '';

  const [meta, setMeta] = useState<RunMeta | null>(null);

  useEffect(() => {
    async function fetchMeta() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/runs`);
        if (!res.ok) return;
        const runs = (await res.json()) as {
          id: string;
          phase: string;
          model: string | null;
          status: string;
          exitCode: number | null;
          durationMs: number | null;
        }[];
        const run = runs.find((r) => r.id === runId);
        if (run) {
          setMeta({
            phase: run.phase,
            model: run.model,
            status: run.status,
            exitCode: run.exitCode,
            durationMs: run.durationMs,
          });
        }
      } catch {
        // non-fatal; meta is decorative
      }
    }
    void fetchMeta();
  }, [jobId, runId]);

  // Show a loading shimmer until we know the status. Once we know it's not
  // RUNNING we render StaticOutput; otherwise StreamingOutput takes over.
  if (!meta) {
    return (
      <div class="flex flex-col h-full overflow-hidden">
        <header class="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
          <button
            class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={() => navigate(`/jobs/${jobId}`)}
          >
            ← Job detail
          </button>
        </header>
        <div class="flex-1 bg-black flex items-center justify-center">
          <div class="w-5 h-5 border-2 border-zinc-700 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (TERMINAL_STATUSES.has(meta.status)) {
    return <StaticOutput jobId={jobId} runId={runId} meta={meta} />;
  }

  return <StreamingOutput jobId={jobId} runId={runId} meta={meta} onMetaUpdate={setMeta} />;
}
