import { buildSpawnSpec, extractJsonBlock } from './agent.utility.js';

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
});

describe('buildSpawnSpec', () => {
  it('builds a local hermes invocation with the headless flags', () => {
    const spec = buildSpawnSpec({
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
    const spec = buildSpawnSpec({
      sandboxMode: 'docker',
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
    const spec = buildSpawnSpec({
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
