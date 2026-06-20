import { IconChevron } from './Icons.tsx';
import { stripAnsi } from './format.tsx';

// ── Data types ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: string;
  content: unknown;
}
export interface TodoItem {
  id: string | number;
  content: string;
  status: string;
}
export interface LlmToolCall {
  name?: string;
  arguments?: string;
  function?: { name?: string; arguments?: string };
}

export function isChatMessages(v: unknown): v is ChatMessage[] {
  return (
    Array.isArray(v) && v.length > 0 && typeof (v[0] as Record<string, unknown>)?.role === 'string'
  );
}
export function isTodoList(v: unknown): v is TodoItem[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v[0] as Record<string, unknown>)?.content === 'string' &&
    'status' in (v[0] as object)
  );
}
export function parseObs(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
export function isDiff(text: string): boolean {
  return /^[-+]{3} |^@@/m.test(text);
}

// ── Observation value renderers ────────────────────────────────────────────

export function ChatMessages({ messages }: { messages: ChatMessage[] }) {
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

export function DiffView({ text }: { text: string }) {
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
              {line || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Terminal renderer ─────────────────────────────────────────────────────

export function TerminalInput({ command, workdir }: { command: string; workdir?: string }) {
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

export function TerminalOutput({
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

export function TodoList({ items }: { items: TodoItem[] }) {
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

export function TodoSummary({ summary }: { summary: Record<string, number> }) {
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

export function FileOpResult({ data }: { data: Record<string, unknown> }) {
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

export function LlmToolCallList({ calls }: { calls: LlmToolCall[] }) {
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

export function KeyValueBlock({ obj }: { obj: Record<string, unknown> }) {
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

export function obsPreview(raw: string | undefined): string {
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

export function ToolInputContent({ raw, toolName }: { raw: string | undefined; toolName: string }) {
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

export function ToolOutputContent({
  raw,
  toolName,
}: {
  raw: string | undefined;
  toolName: string;
}) {
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

export function SectionToggle({
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
