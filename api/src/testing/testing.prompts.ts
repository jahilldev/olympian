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
   - **CRITICAL — foreground processes will permanently hang this session:** Commands like \`vite\`, \`npm run dev\`, \`npm run start\`, \`npm exec vite\`, \`next dev\`, \`node server.js\`, or any other server/watcher MUST be started in the background. Use the exact pattern: \`<command> > /tmp/server.log 2>&1 &\` then wait a few seconds and verify with curl before continuing. Example: \`npx vite --port 5173 > /tmp/vite.log 2>&1 & sleep 4 && curl -sf http://localhost:5173\`. Running any of these without \`&\` will cause this session to hang forever — the command will never return, no further actions can run, and the entire test will time out and be counted as a failure.
   - **Verifying background processes:** After starting with \`&\`, give the process time to reach a ready state, then verify it's working: for web servers, curl the endpoint and check for 200 OK; for build processes, tail the log file to confirm progress; for CLIs, check that expected output files are being created. **Once verified as working, move on immediately.** Do not poll repeatedly, do not wait for the process to "complete" (it won't — servers and watchers run until the session ends), and do not use any tool/command that blocks waiting for the background process. If verification fails (server won't start, build errors), check the logs, document the failure, and move on — do not retry indefinitely.
   - **One-shot build commands blocked by the terminal tool:** If the terminal tool rejects a build command like \`npx vite build\` or \`npm run build\` with a "long-lived server" error, the tool is incorrectly pattern-matching on the command name. Work around it using \`execute_code\` with Python subprocess: \`import subprocess; r = subprocess.run(['npx', 'vite', 'build'], cwd='/workspace/your-project', capture_output=True, text=True, timeout=120); print(r.stdout); print(r.stderr)\`. This runs the same command without triggering the false-positive check.
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
