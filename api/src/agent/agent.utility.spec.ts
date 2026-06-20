import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  buildAgentSpec,
  buildVerifySpec,
  extractJsonBlock,
  generateHermesConfig,
  incompleteOutputReason,
} from './agent.utility.js';

describe('buildVerifySpec', () => {
  it('runs the command in the agent image with the worktree, cache and job label (default mode)', () => {
    const spec = buildVerifySpec({
      sandboxMode: 'default',
      dockerImage: 'hermes-agent:latest',
      dir: '/abs/work/job1',
      cacheDir: '/abs/work/.npm-cache',
      command: 'npm ci && npm run build',
      jobId: 'job1',
    });
    expect(spec.command).toBe('docker');
    const joined = spec.args.join(' ');
    expect(joined).toContain('-v /abs/work/job1:/workspace');
    expect(joined).toContain('-v /abs/work/.npm-cache:/root/.npm');
    expect(joined).toContain('--label olympian.job=job1');
    // command runs via sh -c, after the image, not the hermes binary
    expect(spec.args.slice(-3)).toEqual(['sh', '-c', 'npm ci && npm run build']);
    expect(spec.args).toContain('hermes-agent:latest');
    expect(spec.args).not.toContain('hermes');
    expect(spec.containerName).toMatch(/^olympian-verify-/);
  });

  it('runs as a host subprocess in none mode', () => {
    const spec = buildVerifySpec({
      sandboxMode: 'none',
      dockerImage: 'hermes-agent:latest',
      dir: '/abs/work/job1',
      command: 'pytest -q',
    });
    expect(spec.command).toBe('sh');
    expect(spec.args).toEqual(['-c', 'pytest -q']);
    expect(spec.containerName).toBeUndefined();
  });
});

describe('incompleteOutputReason', () => {
  it('flags output below the minimum length', () => {
    expect(incompleteOutputReason('Should I continue?', 200)).toMatch(/too short/);
  });

  it('passes output that meets the minimum length', () => {
    expect(incompleteOutputReason('x'.repeat(250), 200)).toBeNull();
  });

  it('ignores surrounding whitespace when measuring', () => {
    expect(incompleteOutputReason(`   ${'y'.repeat(50)}   `, 200)).toMatch(/50 chars/);
  });
});

describe('extractJsonBlock', () => {
  it('extracts a fenced json block', () => {
    expect(extractJsonBlock('text ```json\n{"a":1}\n``` more')).toEqual({ a: 1 });
  });

  it('falls back to the outermost braces', () => {
    expect(extractJsonBlock('prefix {"a":2,"b":[1,2]} suffix')).toEqual({ a: 2, b: [1, 2] });
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonBlock('just prose')).toBeNull();
  });

  it('prefers the ```json fence over a plain ``` fence that appears first', () => {
    const text = 'analysis\n```\nsome code\n```\nverdict\n```json\n{"confidence":80}\n```';
    expect(extractJsonBlock(text)).toEqual({ confidence: 80 });
  });

  it('handles embedded backtick fences inside JSON string values', () => {
    // An LLM may put a code example (fenced with ```) inside a JSON "detail" field.
    // The brace-counter must treat backticks as plain characters and not stop early.
    const detail = 'Bad code:\n```typescript\nconst x = 1;\n```';
    // JSON.stringify produces valid JSON with properly escaped newlines and backticks.
    const text = `\`\`\`json\n${JSON.stringify({ verdict: 'FAIL', detail })}\n\`\`\``;
    expect(extractJsonBlock(text)).toEqual({ verdict: 'FAIL', detail });
  });

  it('extracts JSON from a truncated (unclosed) fenced block', () => {
    const text = 'preamble\n```json\n{"confidence":70,"verdict":"FAIL","issues":[{"severity":"hi';
    // Truncated — JSON.parse will fail, but the test confirms we attempt the right content.
    expect(extractJsonBlock(text)).toBeNull(); // incomplete JSON is still unparseable
  });

  it('extracts JSON when it appears first (new-style output)', () => {
    const text =
      '```json\n{"confidence":95,"verdict":"PASS","issues":[]}\n```\n\nDetailed analysis...';
    expect(extractJsonBlock(text)).toEqual({ confidence: 95, verdict: 'PASS', issues: [] });
  });
});

describe('buildAgentSpec', () => {
  it('builds a local hermes invocation with the headless flags', () => {
    const spec = buildAgentSpec({
      sandboxMode: 'none',
      hermesBin: 'hermes',
      dockerImage: 'img',
      cwd: '/w',
      prompt: 'test prompt',
    });
    expect(spec.command).toBe('hermes');
    expect(spec.args).toEqual(
      expect.arrayContaining(['-z', 'test prompt', '--yolo', '--accept-hooks']),
    );
  });

  it('mounts the workspace and hermes memory paths into the container', () => {
    const spec = buildAgentSpec({
      sandboxMode: 'default',
      hermesBin: 'hermes',
      dockerImage: 'img',
      cwd: '/jobs/abc',
      hermesHome: '/cfg',
      prompt: 'test prompt',
    });
    expect(spec.command).toBe('docker');
    expect(spec.args).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '-i',
        '-v',
        '/jobs/abc:/workspace',
        '-v',
        '/cfg/MEMORY.md:/root/.hermes/MEMORY.md',
        '-v',
        '/cfg/USER.md:/root/.hermes/USER.md',
        '-v',
        '/cfg/skills:/root/.hermes/skills',
        'img',
        'hermes',
      ]),
    );
  });

  it('passes model/provider through when set', () => {
    const spec = buildAgentSpec({
      sandboxMode: 'none',
      hermesBin: 'hermes',
      dockerImage: 'img',
      cwd: '/w',
      prompt: 'test prompt',
      model: 'anthropic/claude-sonnet-4.6',
      provider: 'anthropic',
    });
    expect(spec.args).toEqual(
      expect.arrayContaining(['--model', 'anthropic/claude-sonnet-4.6', '--provider', 'anthropic']),
    );
  });
});

describe('generateHermesConfig auxiliary model', () => {
  type AuxTask = { provider?: string; model?: string; timeout?: number };
  async function generateAuxiliary(
    opts: Record<string, unknown>,
  ): Promise<Record<string, AuxTask>> {
    const dir = await mkdtemp(join(tmpdir(), 'olympian-aux-'));
    try {
      await generateHermesConfig(dir, { sandboxMode: 'none', ...opts });
      const config = parseYaml(await readFile(join(dir, 'config.yaml'), 'utf8')) as {
        auxiliary?: Record<string, AuxTask>;
      };
      return config.auxiliary ?? {};
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('applies the auxiliary model and provider over the base config for every task', async () => {
    const aux = await generateAuxiliary({
      auxiliaryModel: 'qwen3.6:8b',
      auxiliaryProvider: 'custom',
    });
    for (const task of ['vision', 'web_extract', 'compression']) {
      expect(aux[task]).toMatchObject({ provider: 'custom', model: 'qwen3.6:8b' });
    }
  });

  it('applies each override independently', async () => {
    const aux = await generateAuxiliary({ auxiliaryModel: 'qwen3.6:8b' });
    expect(aux.compression).toMatchObject({ model: 'qwen3.6:8b' });
    expect(aux.compression.provider).toBeUndefined();
  });

  it('keeps the base auxiliary timeouts (no model/provider) when neither override is set', async () => {
    const aux = await generateAuxiliary({});
    expect(aux.compression.model).toBeUndefined();
    expect(aux.compression.provider).toBeUndefined();
    expect(typeof aux.compression.timeout).toBe('number');
  });
});
