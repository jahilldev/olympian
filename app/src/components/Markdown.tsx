import { marked } from 'marked';
import DOMPurify from 'dompurify';

const PROSE =
  'prose prose-sm prose-invert max-w-none ' +
  'prose-headings:font-semibold prose-headings:text-zinc-100 ' +
  'prose-p:text-zinc-300 prose-p:leading-relaxed ' +
  'prose-a:text-blue-400 hover:prose-a:text-blue-300 ' +
  'prose-strong:text-zinc-200 ' +
  'prose-code:text-amber-300 prose-code:bg-zinc-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.8em] prose-code:before:content-none prose-code:after:content-none ' +
  'prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 ' +
  'prose-blockquote:border-zinc-700 prose-blockquote:text-zinc-400 ' +
  'prose-hr:border-zinc-800 prose-li:text-zinc-300';

/** Renders trusted-then-sanitized Markdown. Reused by the create composer, plan thread, and chat. */
export default function Markdown({ text, class: cls }: { text: string; class?: string }) {
  const rawHtml = marked.parse(text) as string;
  const wrapped = rawHtml
    .replace(/<table>/g, '<div class="overflow-x-auto w-full"><table class="min-w-full">')
    .replace(/<\/table>/g, '</table></div>');
  const html = DOMPurify.sanitize(wrapped);

  return (
    <div
      class={`${PROSE} ${cls ?? ''}`}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
