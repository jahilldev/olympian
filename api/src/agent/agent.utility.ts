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
 * with only the worktree mounted — the image's baked config is always used so the
 * provider URL is correct for container networking. The prompt is delivered via stdin.
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
    args.push(p.dockerImage, 'hermes', ...hermesArgs(p));
    return { command: 'docker', args, env: process.env };
  }
  return {
    command: p.hermesBin,
    args: hermesArgs(p),
    env: { ...process.env, ...(p.hermesHome ? { HERMES_HOME: p.hermesHome } : {}) },
  };
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
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(spec.command, spec.args, {
      cwd: opts.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: cap(stdout),
        stderr: cap(stderr),
        durationMs: Date.now() - start,
        timedOut,
      });
    };

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < STDOUT_CAP) {
        stdout += d.toString();
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < STDOUT_CAP) {
        stderr += d.toString();
      }
    });
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));

    child.stdin.end();
  });
}

/**
 * Extracts a JSON object from agent stdout. Prefers a ```json fenced block; falls
 * back to the outermost {...}. Returns null when nothing parseable is found.
 */
export function extractJsonBlock(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced) {
    candidates.push(fenced[1]);
  }
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
