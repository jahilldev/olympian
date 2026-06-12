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

    const containerName = `olympian-${randomUUID()}`;

    args.push('--name', containerName);
    args.push(p.dockerImage, 'hermes', ...hermesArgs(p));

    return { command: 'docker', args, env: process.env, containerName };
  }

  return {
    command: p.hermesBin,
    args: hermesArgs(p),
    env: { ...process.env, ...(p.hermesHome ? { HERMES_HOME: p.hermesHome } : {}) },
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
  opts: { cwd: string; hardTimeoutMs: number; idleTimeoutMs: number },
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

    // Absolute ceiling: kill regardless of activity after hardTimeoutMs.
    const hardTimer = setTimeout(kill, opts.hardTimeoutMs);

    // Idle cap: reset whenever the process emits output. Fires only when silent.
    let idleTimer = setTimeout(kill, opts.idleTimeoutMs);

    const resetIdle = () => {
      clearTimeout(idleTimer);

      idleTimer = setTimeout(kill, opts.idleTimeoutMs);
    };

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }

      settled = true;

      clearTimeout(hardTimer);
      clearTimeout(idleTimer);

      resolve({
        exitCode,
        stdout: cap(Buffer.concat(stdoutChunks).toString()),
        stderr: cap(Buffer.concat(stderrChunks).toString()),
        durationMs: Date.now() - start,
        timedOut,
      });
    };

    child.stdout.on('data', (d: Buffer) => {
      resetIdle();

      if (stdoutLen < STDOUT_CAP) {
        stdoutChunks.push(d);
        stdoutLen += d.length;
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      resetIdle();

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

  // Prefer the FIRST complete fenced block — the review prompt instructs models to
  // put their JSON verdict before any analysis, so this is almost always the right one.
  const firstFenced = text.match(/```(?:json)?[ \t]*\n([\s\S]*?)```/i);

  if (firstFenced?.[1]) {
    candidates.push(firstFenced[1]);
  }

  // Fall back to the LAST opened fence to handle truncated stdout: the first-fence
  // regex above requires a closing ``` and won't match if the output was cut off by
  // STDOUT_CAP before the fence closed. The last-fence path tolerates a missing close.
  const lastJsonFence = text.lastIndexOf('```json');
  const lastPlainFence = text.lastIndexOf('```\n');
  const lastFenceIdx = Math.max(lastJsonFence, lastPlainFence);

  if (lastFenceIdx !== -1) {
    const afterFence = text.slice(lastFenceIdx).replace(/^```(?:json)?[ \t]*\n?/, '');
    const closeIdx = afterFence.indexOf('```');
    const content = (closeIdx !== -1 ? afterFence.slice(0, closeIdx) : afterFence).trim();

    if (content) candidates.push(content);
  }

  // Last-resort: outermost { ... } pair.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');

  if (first !== -1 && last > first) {
    candidates.push(text.slice(first, last + 1));
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
