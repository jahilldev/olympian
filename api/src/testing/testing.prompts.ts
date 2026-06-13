import { type TestPromptContext } from './testing.model.js';

const TEST_OUTPUT_CONTRACT = `Output your verdict as the FIRST thing in your response — a \`\`\`json block before any other text:
\`\`\`json
{
  "passed": true | false,
  "summary": "<one-paragraph summary of what ran and the overall outcome>",
  "failures": [
    { "name": "<test name, command, or category that failed>", "detail": "<what went wrong and any relevant output>" }
  ]
}
\`\`\`
Set "passed" to true only if ALL tests pass AND the application starts and runs correctly. Use an empty array for "failures" when passing. You may include detailed output after the JSON block.`;

export function buildTestPrompt(ctx: TestPromptContext): string {
  const parts: string[] = [
    `You are Hermes, an autonomous engineer working in a clone of \`${ctx.repoFullName}\`. Your task is to verify the implementation for: **${ctx.issueTitle}**.`,
    `--- APPROVED PLAN ---\n${ctx.plan}\n--- END PLAN ---`,
    `Instructions:
1. Discover the test suite by inspecting the project structure (look for \`package.json\` test scripts, \`pytest.ini\`, \`jest.config.*\`, \`vitest.config.*\`, \`go.mod\`, \`Makefile\`, etc.).
2. Run the tests and capture the full output.
3. **Try to run the application itself** — start the dev server, CLI, or process and verify it launches without errors. For web/browser applications, open the running app in the browser and exercise the key user flows from the acceptance criteria. For CLI tools, invoke the main commands and check the output.
   - **Important:** dev servers and long-running processes must be started in the background so the shell command returns immediately. Use \`command > /tmp/server.log 2>&1 &\` then \`sleep 3 && curl -s http://localhost:<port>\` (or similar) to confirm it started before proceeding to browser tests. Never run a dev server in the foreground — it will block indefinitely.
4. Do NOT modify any source files — if tests fail or the application errors, document what went wrong. Fixes are handled in a separate step.`,
  ];

  if (ctx.hasBrowser) {
    parts.push(
      `A Camofox browser is available. Use it to open the running application and manually verify the acceptance criteria — click through real user flows, not just check that the page loads.`,
    );
  }

  if (ctx.priorOutput) {
    parts.push(
      `The previous test run ended with this output — use it as your starting point:\n\`\`\`\n${ctx.priorOutput.slice(0, 4000)}\n\`\`\``,
    );
  }

  parts.push(
    `Use \`.olympian/\` as a scratch directory for any temporary files (diffs, logs, etc.) — it is excluded from commits automatically. Do not run git yourself.`,
    TEST_OUTPUT_CONTRACT,
  );

  return parts.join('\n\n');
}
