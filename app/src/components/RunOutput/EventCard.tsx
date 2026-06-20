import { useState } from 'preact/hooks';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { LangfuseEvent } from '@olympian/api/langfuse/langfuse.model.js';
import { IconBrain, IconWrench } from './Icons.tsx';
import { fmtTime, splitThinking } from './format.tsx';
import {
  ChatMessages,
  isChatMessages,
  LlmToolCallList,
  obsPreview,
  parseObs,
  SectionToggle,
  ToolInputContent,
  ToolOutputContent,
  type LlmToolCall,
} from './Observations.tsx';
import { CompressionCard, isExplicitCompression } from './Compression.tsx';

function GenerationCard({ event }: { event: LangfuseEvent }) {
  const [inputOpen, setInputOpen] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const body = event.body;
  const model = body['langfuse.observation.model.name'] as string | undefined;
  const usageRaw = body['langfuse.observation.usage_details'] as string | undefined;
  const usage = usageRaw ? (JSON.parse(usageRaw) as Record<string, number>) : null;
  const totalTokens = usage?.total ?? usage?.output ?? null;
  const outputTokens = usage?.output ?? null;

  const startTime = body.startTime as string | undefined;
  const endTime = body.endTime as string | undefined;
  const durationMs =
    startTime && endTime ? new Date(endTime).getTime() - new Date(startTime).getTime() : null;
  const tps =
    outputTokens != null && durationMs != null && durationMs > 0
      ? outputTokens / (durationMs / 1000)
      : null;
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
          <span class="text-zinc-600 font-mono text-[10px] tabular-nums">
            {totalTokens.toLocaleString()} tok
          </span>
        )}
        {tps != null && (
          <span class="text-zinc-600 font-mono text-[10px] tabular-nums">
            {tps.toFixed(1)} tok/s
          </span>
        )}
        <span class="ml-auto shrink-0 text-zinc-700 font-mono text-[10px] tabular-nums">
          {fmtTime(event.timestamp)}
        </span>
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
      {output &&
        (() => {
          const rawHtml = marked.parse(output) as string;
          const wrapped = rawHtml
            .replace(/<table>/g, '<div class="overflow-x-auto w-full"><table class="min-w-full">')
            .replace(/<\/table>/g, '</table></div>');
          const html = DOMPurify.sanitize(wrapped);
          return (
            <div class="border-t border-indigo-900/30 px-3 py-3 bg-black/15">
              <div
                class="prose prose-sm prose-invert max-w-none
              prose-headings:font-semibold prose-headings:text-zinc-100
              prose-p:text-zinc-300 prose-p:leading-relaxed
              prose-a:text-blue-400 hover:prose-a:text-blue-300
              prose-strong:text-zinc-200
              prose-code:text-amber-300 prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800
              prose-blockquote:border-zinc-700 prose-blockquote:text-zinc-400
              prose-hr:border-zinc-800
              prose-li:text-zinc-300
              prose-table:text-zinc-300 prose-thead:border-zinc-700 prose-tbody:divide-zinc-800"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          );
        })()}
    </div>
  );
}

function ToolCard({ event }: { event: LangfuseEvent }) {
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const body = event.body;
  const name = String(body['langfuse.observation.name'] ?? body.name ?? 'unknown');
  const displayName = name.replace(/^Tool:\s*/i, '');
  const rawInput = body['langfuse.observation.input'] as string | undefined;
  const rawOutput = body['langfuse.observation.output'] as string | undefined;

  return (
    <div class="rounded-xl border border-amber-900/40 overflow-hidden text-xs shadow-sm">
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2.5 bg-amber-950/25 text-amber-200">
        <IconWrench />
        <span class="font-semibold font-mono tracking-wide">TOOL</span>
        <span class="text-zinc-300 font-mono font-medium">{displayName}</span>
        <span class="ml-auto shrink-0 text-zinc-700 font-mono text-[10px] tabular-nums">
          {fmtTime(event.timestamp)}
        </span>
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
      <span class="ml-auto text-zinc-800 tabular-nums">{fmtTime(event.timestamp)}</span>
    </div>
  );
}

export function EventCard({ event }: { event: LangfuseEvent }) {
  if (isExplicitCompression(event)) return <CompressionCard event={event} />;
  const obsType = event.body['langfuse.observation.type'] as string | undefined;
  if (obsType === 'generation') return <GenerationCard event={event} />;
  if (obsType === 'tool') return <ToolCard event={event} />;
  return <GenericSpanCard event={event} />;
}
