import {
  AUTONOMY_NOTICE,
  DELEGATION_STRATEGY,
  READ_DISCIPLINE,
  STATIC_ANALYSIS_INSTRUCTIONS,
  VERIFY_CONTRACT,
  WORKING_MEMORY_CONTRACT,
  progressBlock,
} from '../agent/agent.prompts.js';
import { type ImplementPromptContext } from './implement.model.js';

const IMPLEMENT_OUTPUT_CONTRACT = `# Finishing

The orchestrator's closing job:

- Before ending, confirm every deliverable in the plan exists on disk with real content: cross-check the plan's file list against \`.olympian/PROGRESS.md\` and the filesystem, and delegate any gaps. Never finish on a partial implementation.
- Then run the acceptance-criteria tests and a whole-repo static-analysis pass; confirm all tests pass and zero errors remain.
- End with a short Markdown summary of what changed and which acceptance criteria now pass as tests.
- Use individual tool calls — not batch mode or multi-task arrays. Do not start a dev server (the review stage handles runtime testing).`;

export function buildImplementPrompt(ctx: ImplementPromptContext): string {
  // Injected documents stay wrapped in `--- NAME --- … ---` fences so their own Markdown
  // headings (e.g. a plan's "## Steps") never read as one of the prompt's own sections.
  const context: string[] = [
    `--- ISSUE: ${ctx.issueTitle} ---\n${ctx.issueBody}\n--- END ISSUE ---`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
  ];

  if (ctx.guidance) {
    context.push(
      `--- MANDATORY CORRECTIONS (read in full before doing anything else) ---\n${ctx.guidance}\n--- END CORRECTIONS ---\n\nThis is a retry — the workspace already contains code from the previous attempt. Do NOT recreate files that already exist and do NOT re-implement work that is already done. Survey the workspace first, then address ONLY the specific items listed in the corrections above.`,
    );
  }

  if (ctx.progress) {
    context.push(progressBlock(ctx.progress));
  }

  if (ctx.attachments) {
    context.push(ctx.attachments);
  }

  const parts: string[] = [
    `# Role

You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`, acting as the ORCHESTRATOR. Your objective: implement the approved plan to fully resolve the issue below. This is implementation attempt ${ctx.attempt}.

You are already inside the repository — your working directory IS the repo root. Do NOT use git (the orchestrator handles all git operations) and do NOT clone, fetch, or browse GitHub: the issue and plan below are complete, so work only from them and the local files.`,
    `# Context\n\n${context.join('\n\n')}`,
    AUTONOMY_NOTICE,
    WORKING_MEMORY_CONTRACT,
    DELEGATION_STRATEGY,
    READ_DISCIPLINE,
    VERIFY_CONTRACT,
    IMPLEMENT_OUTPUT_CONTRACT,
    STATIC_ANALYSIS_INSTRUCTIONS,
  ];

  return parts.join('\n\n');
}
