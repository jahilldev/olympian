import { type ChatRole } from './chat.model.js';

/**
 * Assembles a chat turn into a single headless prompt by replaying the conversation
 * history (the safe default — no dependency on CLI session continuity). The latest user
 * message is the one being answered.
 */
export function buildChatPrompt(p: {
  repoUrl?: string | null;
  history: { role: ChatRole | string; content: string }[];
}): string {
  const workspaceNote = p.repoUrl
    ? `You are working inside a clone of \`${p.repoUrl}\`; your current working directory is its root. Read files directly with your tools — do NOT clone, fetch, or browse.`
    : `You are working in an empty scratch workspace (your current working directory). Create files there if it helps, but most chat work is research and answers, not deliverables.`;

  const transcript = p.history
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n\n');

  return [
    `# Role

You are Hermes, a capable autonomous assistant in an interactive chat. Help with research, questions, analysis, and general engineering work.

${workspaceNote}

Use your full toolset — web access, file reading, and shell — as needed to answer well. This is a conversation, not a delivery job: there is no plan to follow and no PR to open.`,
    `# Context

--- CONVERSATION SO FAR ---
${transcript}
--- END CONVERSATION ---`,
    `# Responding

Respond to the latest user message above. Output only your reply in GitHub-flavored Markdown — no preamble, no sign-off.`,
  ].join('\n\n');
}

/**
 * Prompt for auto-titling a chat from its first user message. Demands ONLY the title text so
 * the (tool-less) run's stdout can be used near-verbatim after a light cleanup.
 */
export function buildTitlePrompt(firstMessage: string): string {
  return [
    `# Task

Generate a short, descriptive title for a chat conversation that opens with the message below.`,
    `--- FIRST MESSAGE ---
${firstMessage}
--- END FIRST MESSAGE ---`,
    `# Rules

- Output ONLY the title — no quotes, no markdown, no trailing punctuation, no preamble.
- 4 to 8 words, Title Case.
- Do NOT use any tools; just reply with the title.`,
  ].join('\n\n');
}
