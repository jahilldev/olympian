import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { STDOUT_CAP, type RawSpawnResult, type SpawnSpec } from './agent.model.js';

const HERMES_CONTAINER_HOME = '/root/.hermes';
const CONTAINER_WORKDIR = '/workspace';

export interface SpawnSpecParams {
  sandboxMode: 'none' | 'docker';
  hermesBin: string;
  dockerImage: string;
  hermesHome?: string;
  cwd: string;
  prompt: string;
  model?: string;
  provider?: string;
  toolsets?: string;
  skills?: string[];
}

/** Hermes flags shared by every invocation: headless, autonomous, tagged as a tool. */
function hermesArgs(p: SpawnSpecParams): string[] {
  const args = ['-z', p.prompt, '--yolo', '--accept-hooks'];

  if (p.model) {
    args.push('--model', p.model);
  }

  if (p.provider) {
    args.push('--provider', p.provider);
  }

  if (p.toolsets) {
    args.push('-t', p.toolsets);
  }

  for (const skill of p.skills ?? []) {
    args.push('--skills', skill);
  }

  return args;
}

/**
 * Builds the spawn spec for a Hermes run. `none` runs the binary directly in the
 * worktree (HERMES_HOME forwarded via env if set); `docker` runs it in a container
 * with the worktree mounted and — when HERMES_HOME is set — individual memory
 * paths bind-mounted so MEMORY.md, USER.md, and skills survive across invocations.
 */
export function buildSpawnSpec(p: SpawnSpecParams): SpawnSpec {
  if (p.sandboxMode === 'docker') {
    const args = [
      'run',
      '--rm',
      '-i',
      '--add-host=host.docker.internal:host-gateway',
      '-v',
      `${p.cwd}:${CONTAINER_WORKDIR}`,
      '-w',
      CONTAINER_WORKDIR,
    ];

    // Mount individual hermes memory paths so learning persists across invocations.
    // Only MEMORY.md, USER.md, and skills/ are mounted — the baked config.yaml and
    // SOUL.md inside the image are left untouched.
    if (p.hermesHome) {
      const mounts: Array<[string, string]> = [
        [join(p.hermesHome, 'MEMORY.md'), `${HERMES_CONTAINER_HOME}/MEMORY.md`],
        [join(p.hermesHome, 'USER.md'), `${HERMES_CONTAINER_HOME}/USER.md`],
        [join(p.hermesHome, 'skills'), `${HERMES_CONTAINER_HOME}/skills`],
      ];

      for (const [host, container] of mounts) {
        args.push('-v', `${host}:${container}`);
      }
    }

    // Without a TTY, Python uses block buffering which starves the idle timer.
    // PYTHONUNBUFFERED=1 forces line/byte flushing so output reaches the pipe immediately.
    args.push('--env', 'PYTHONUNBUFFERED=1');

    // Forward CAMOFOX_URL into the container, rewriting localhost → host.docker.internal
    // so the agent can reach a Camofox server running on the host.
    const camofoxUrl = process.env.CAMOFOX_URL;

    if (camofoxUrl) {
      args.push(
        '--env',
        `CAMOFOX_URL=${camofoxUrl.replace(/\/\/localhost(:|$)/g, '//host.docker.internal$1')}`,
      );
    }

    // Always forward fixed Langfuse credentials so the baked-in observability plugin
    // emits traces to Olympian's trace receiver without any user configuration.
    // The base URL uses host.docker.internal so the agent container reaches the
    // host-side (or sibling-container) service. A per-run session ID is injected
    // separately by agent.service.ts after the AgentRun record is created.
    const langfusePort = process.env.PORT ?? '3030';

    args.push('--env', 'HERMES_LANGFUSE_PUBLIC_KEY=pk-lf-olympian');
    args.push('--env', 'HERMES_LANGFUSE_SECRET_KEY=sk-lf-olympian');

    args.push(
      '--env',
      `HERMES_LANGFUSE_BASE_URL=http://host.docker.internal:${langfusePort}/langfuse`,
    );

    const containerName = `olympian-${randomUUID()}`;

    args.push('--name', containerName);
    args.push(p.dockerImage, 'hermes', ...hermesArgs(p));

    return { command: 'docker', args, env: process.env, containerName };
  }

  const port = process.env.PORT ?? '3030';

  return {
    command: p.hermesBin,
    args: hermesArgs(p),
    env: {
      ...process.env,
      // Fixed Langfuse credentials — agent reaches Olympian's trace receiver at localhost.
      HERMES_LANGFUSE_PUBLIC_KEY: 'pk-lf-olympian',
      HERMES_LANGFUSE_SECRET_KEY: 'sk-lf-olympian',
      HERMES_LANGFUSE_BASE_URL: `http://localhost:${port}/langfuse`,
      ...(p.hermesHome ? { HERMES_HOME: p.hermesHome } : {}),
    },
  };
}

/** Touches MEMORY.md and USER.md in hermesHome so Docker can bind-mount them. */
export function prepareHermesMemoryPaths(hermesHome: string): void {
  writeFileSync(join(hermesHome, 'MEMORY.md'), '', { flag: 'a' });
  writeFileSync(join(hermesHome, 'USER.md'), '', { flag: 'a' });
}

function cap(buf: string): string {
  return buf.length > STDOUT_CAP ? `${buf.slice(0, STDOUT_CAP)}\n…[truncated]` : buf;
}

/**
 * Spawns a process, captures (capped) stdout/stderr, and hard-kills it after
 * `timeoutMs`. Never rejects — failures surface in the result.
 */
export function spawnProcess(
  spec: SpawnSpec,
  opts: { cwd: string; timeoutMs: number },
): Promise<RawSpawnResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    const child = spawn(spec.command, spec.args, {
      cwd: opts.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const kill = () => {
      timedOut = true;

      child.kill('SIGKILL');

      // Force-remove the container in case killing the docker-run process doesn't
      // stop it (no TTY means Docker daemon may keep the container alive).
      if (spec.containerName) {
        spawn('docker', ['rm', '-f', spec.containerName], { stdio: 'ignore' }).unref();
      }
    };

    const timer = setTimeout(kill, opts.timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }

      settled = true;

      clearTimeout(timer);

      resolve({
        exitCode,
        stdout: cap(Buffer.concat(stdoutChunks).toString()),
        stderr: cap(Buffer.concat(stderrChunks).toString()),
        durationMs: Date.now() - start,
        timedOut,
      });
    };

    child.stdout.on('data', (d: Buffer) => {
      if (stdoutLen < STDOUT_CAP) {
        stdoutChunks.push(d);
        stdoutLen += d.length;
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      if (stderrLen < STDOUT_CAP) {
        stderrChunks.push(d);
        stderrLen += d.length;
      }
    });

    child.on('error', (err) => {
      stderrChunks.push(Buffer.from(`\n[spawn error] ${err.message}`));

      finish(null);
    });

    child.on('close', (code) => finish(code));
  });
}

/**
 * Extracts a JSON object from agent stdout. Prefers a ```json fenced block; falls
 * back to the outermost {...}. Returns null when nothing parseable is found.
 */
export function extractJsonBlock(text: string): unknown | null {
  const candidates: string[] = [];

  // Strategy 1: brace-count from the first ```json fence.
  //
  // Why brace-counting instead of a regex:
  //   - The regex /```[\s\S]*?```/ is non-greedy and stops at the first ``` it sees.
  //     When an LLM embeds code examples inside a JSON "detail" string, those inner
  //     backtick fences break the regex, producing truncated (invalid) JSON.
  //   - lastIndexOf-based fallbacks land on code fences in the prose that follows the
  //     verdict, not on the verdict itself.
  //   - A brace-counter treats ``` as plain characters inside strings; it only cares
  //     about { } depth and string boundaries ("..." with \" escapes).
  //
  // The review/agent prompts ask models to put their JSON verdict FIRST, so the first
  // ```json fence is almost always the verdict.
  const firstJsonFenceIdx = text.indexOf('```json');
  if (firstJsonFenceIdx !== -1) {
    const afterFence = text.slice(firstJsonFenceIdx).replace(/^```json[ \t]*\n?/, '');
    const obj = extractFirstJsonObject(afterFence);
    if (obj !== null) {
      candidates.push(obj);
    }
  }

  // Strategy 2: brace-count from the first plain ``` fence (handles ```\n{...}).
  const firstPlainFenceIdx = text.indexOf('```\n');
  if (firstPlainFenceIdx !== -1) {
    const afterFence = text.slice(firstPlainFenceIdx + 4);
    const obj = extractFirstJsonObject(afterFence);
    if (obj !== null) {
      candidates.push(obj);
    }
  }

  // Strategy 3: brace-count across the entire text (no fence markers present).
  const obj = extractFirstJsonObject(text);
  if (obj !== null) {
    candidates.push(obj);
  }

  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      // try next candidate
    }
  }

  return null;
}

/**
 * Scans `text` for the first complete JSON object (outermost `{...}`) using a
 * brace-depth counter that correctly handles string literals (including escaped
 * quotes and embedded backtick fences). Returns the raw substring, or null if no
 * complete object is found (e.g. truncated output).
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
