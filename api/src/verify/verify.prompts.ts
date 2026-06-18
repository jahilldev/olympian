import { type VerifyPromptContext } from './verify.model.js';

export function buildVerifyPrompt(ctx: VerifyPromptContext): string {
  return [
    `You are Hermes working in a clone of \`${ctx.repoFullName}\`. Your current working directory IS the repo root. Determine the single shell command that best verifies whether a change to this repository is correct.`,
    `The command will be run non-interactively from the repo root by an automated system (not by you). It must:
- Install dependencies first if the project needs them (e.g. \`npm ci\`, \`pip install\`, \`go mod download\`), then run the project's real automated checks: type-checks, linters, and unit/integration tests, and/or a build — whatever this repo actually has.
- Chain steps with \`&&\` so the whole command fails if any step fails.
- Use the project's OWN conventions. Inspect \`package.json\` scripts, \`Makefile\`/\`justfile\`, \`pyproject.toml\`/\`tox.ini\`/\`setup.cfg\`, \`go.mod\`, \`Cargo.toml\`, and any CI workflows under \`.github/workflows/\` to find the commands the maintainers actually use.
- NOT include watch, serve, or dev-server commands, and NOT depend on interactive input or secrets.`,
    `Read whatever files you need to be confident. Do NOT modify any files.`,
    `If the repository genuinely has no automated checks, return an empty string for the command.`,
    `Output ONLY a JSON object as the FIRST thing in your response, before any other text:
\`\`\`json
{ "command": "<the verification command, or an empty string if none exists>" }
\`\`\`
You may add a brief justification after the JSON block.`,
  ].join('\n\n');
}
