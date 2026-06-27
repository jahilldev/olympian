import { existsSync } from 'node:fs';
import { mkdir, rm, appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git';
import { AppConfigService } from '../config/config.service.js';
import { buildVerifySpec, spawnProcess } from '../agent/agent.utility.js';
import { GithubService } from '../github/github.service.js';
import { type AttachmentRef } from '../github/github.model.js';
import {
  SCRATCH_BASE_BRANCH,
  type DiffSummary,
  type DownloadedAttachment,
  type RemoteAuth,
  type Workspace,
  type WorkspacePrepareInput,
} from './workspace.model.js';
import {
  authenticatedRemoteUrl,
  changedFilesFromStatus,
  sshGitCommand,
  workspaceDir,
} from './workspace.utility.js';

/**
 * Owns all git for a job: cloning the repo into a per-job directory, creating the
 * working branch, committing the agent's file changes, and pushing. The agent only
 * edits files — git stays here so commit hygiene is controlled centrally.
 */
@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly app: GithubService,
  ) {}

  /** Clone (if needed) and check out the job's branch. Idempotent across attempts. */
  async prepare(input: WorkspacePrepareInput): Promise<Workspace> {
    const root = this.config.get('WORKSPACE_ROOT');
    const dir = workspaceDir(root, input.jobId);

    if (input.auth.kind === 'none') {
      return this.prepareScratch(dir, input.jobId, input.branchName);
    }

    const { remote, options } = await this.remoteFor(input.auth);

    if (existsSync(`${dir}/.git`)) {
      const git = simpleGit(dir, options);

      await git.remote(['set-url', 'origin', remote]);
      await git.fetch(['origin']);
      await this.configureIdentity(git);

      const base = input.baseBranch ?? (await this.defaultBranch(git));

      await git.checkout(input.branchName).catch(async () => {
        await git.checkoutBranch(input.branchName, `origin/${base}`);
      });

      await this.writeLocalExcludes(dir);

      return { dir, branch: input.branchName, baseBranch: base };
    }

    await mkdir(root, { recursive: true });

    const git = simpleGit(root, options);

    await git.clone(remote, dir, ['--depth', '1', '--no-single-branch']);

    const repoGit = simpleGit(dir, options);

    await this.configureIdentity(repoGit);

    const base = input.baseBranch ?? (await this.defaultBranch(repoGit));

    await repoGit.checkoutLocalBranch(input.branchName);

    await this.writeLocalExcludes(dir);

    this.logger.log(`[job ${input.jobId}] cloned -> ${dir} (${input.branchName} from ${base})`);

    return { dir, branch: input.branchName, baseBranch: base };
  }

  /**
   * Prepares a greenfield (no-repo) workspace: `git init` with an empty initial commit on
   * a base branch so the job branch has something to diff against. Idempotent across attempts.
   */
  private async prepareScratch(dir: string, jobId: string, branchName: string): Promise<Workspace> {
    if (existsSync(`${dir}/.git`)) {
      const git = simpleGit(dir);

      await this.configureIdentity(git);
      await git.checkout(branchName).catch(async () => {
        await git.checkoutLocalBranch(branchName);
      });
      await this.writeLocalExcludes(dir);

      return { dir, branch: branchName, baseBranch: SCRATCH_BASE_BRANCH };
    }

    await mkdir(dir, { recursive: true });

    const git = simpleGit(dir);

    await git.init();
    await this.configureIdentity(git);
    await git.raw(['commit', '--allow-empty', '-m', 'chore: initialise workspace']);
    await git.raw(['branch', '-M', SCRATCH_BASE_BRANCH]);
    await git.checkoutLocalBranch(branchName);
    await this.writeLocalExcludes(dir);

    this.logger.log(`[job ${jobId}] initialised scratch workspace -> ${dir} (${branchName})`);

    return { dir, branch: branchName, baseBranch: SCRATCH_BASE_BRANCH };
  }

  /** Resolves the remote URL and per-instance git options for an authenticated remote. */
  private async remoteFor(
    auth: Exclude<RemoteAuth, { kind: 'none' }>,
  ): Promise<{ remote: string; options: Partial<SimpleGitOptions> }> {
    if (auth.kind === 'ssh') {
      const keyPath = this.config.get('GIT_SSH_KEY_PATH');

      // No dedicated deploy key configured: use the host's own SSH setup (agent,
      // ~/.ssh/config, default keys) exactly as a normal `git clone git@…` would — no
      // overrides, no env handed to git.
      if (!keyPath) {
        return { remote: auth.url, options: {} };
      }

      // A deploy key IS configured: point git at it via `-c core.sshCommand` (a git arg,
      // not the process env — handing the whole env to git makes simple-git's
      // block-unsafe-operations plugin reject the run when EDITOR/PAGER/etc are set). The
      // matching `unsafe.allowUnsafeSshCommand` flag permits this operator-set override.
      return {
        remote: auth.url,
        options: {
          config: [`core.sshCommand=${sshGitCommand(keyPath)}`],
          unsafe: { allowUnsafeSshCommand: true },
        },
      };
    }

    const token = await this.app.getInstallationToken(auth.installationId);

    return { remote: authenticatedRemoteUrl(auth.owner, auth.repo, token), options: {} };
  }

  /**
   * Appends agent scratch-file patterns to .git/info/exclude so they are never
   * staged or committed. This file is repo-local and never tracked by git.
   */
  private async writeLocalExcludes(dir: string): Promise<void> {
    const excludePath = join(dir, '.git', 'info', 'exclude');
    const marker = '# --- olympian agent scratch space (auto-added) ---';
    const existing = await readFile(excludePath, 'utf8').catch(() => '');

    if (existing.includes(marker)) {
      return;
    }

    await appendFile(excludePath, `\n${marker}\n.olympian/\n`);
  }

  async diffSummary(dir: string): Promise<DiffSummary> {
    const git = simpleGit(dir);
    const status = await git.status();
    const changedFiles = changedFilesFromStatus(status);

    let insertions = 0;
    let deletions = 0;

    try {
      const summary = await git.diffSummary();

      insertions = summary.insertions;
      deletions = summary.deletions;
    } catch {
      // diff summary is best-effort (won't see untracked files)
    }

    return { changedFiles, insertions, deletions, isDirty: changedFiles.length > 0 };
  }

  /** Stage everything and commit. Returns the new commit SHA, or null if nothing to commit. */
  async commitAll(dir: string, message: string): Promise<string | null> {
    const git = simpleGit(dir);

    await git.add(['-A']);

    const status = await git.status();

    if (status.staged.length === 0) {
      return null;
    }

    await git.commit(message);

    return (await git.revparse(['HEAD'])).trim();
  }

  /**
   * Push the job branch. For `github-app` the remote token is refreshed first (tokens
   * expire ~1h); for `ssh` the configured deploy key is used; for `none` (scratch) there
   * is no remote, so this is a no-op that just returns the current HEAD sha.
   */
  async push(input: WorkspacePrepareInput): Promise<string> {
    const dir = workspaceDir(this.config.get('WORKSPACE_ROOT'), input.jobId);
    const git = simpleGit(dir);

    if (input.auth.kind === 'none') {
      return (await git.revparse(['HEAD'])).trim();
    }

    const { remote, options } = await this.remoteFor(input.auth);
    const g = simpleGit(dir, options);

    await g.remote(['set-url', 'origin', remote]);
    await g.push(['-u', 'origin', input.branchName]);

    const sha = (await g.revparse(['HEAD'])).trim();

    this.logger.log(`[job ${input.jobId}] pushed ${input.branchName} @ ${sha}`);

    return sha;
  }

  /** Unified diff of the branch vs its base (committed changes) — for the dashboard result view. */
  async branchDiff(dir: string, baseBranch: string): Promise<string> {
    const git = simpleGit(dir);

    try {
      return await git.diff([`${baseBranch}...HEAD`]);
    } catch {
      return '';
    }
  }

  /** Files changed on the branch relative to its base (committed changes). */
  async branchChangedFiles(dir: string, baseBranch: string): Promise<string[]> {
    const git = simpleGit(dir);

    try {
      const out = await git.diff(['--name-only', `${baseBranch}...HEAD`]);

      return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** True if the branch has at least one commit ahead of its base. */
  async hasCommitsAhead(dir: string, baseBranch: string): Promise<boolean> {
    return (await this.branchChangedFiles(dir, baseBranch)).length > 0;
  }

  /**
   * Runs an agent-discovered verification command (tests/build) as the ground-truth
   * acceptance gate. In sandboxed mode it runs inside the SAME image the agent uses, with
   * the worktree mounted, so the gate reproduces a CLEAN install in the agent's
   * environment — eliminating the host/container divergence that lets an agent's dirty
   * node_modules pass while a clean install fails. A shared npm cache keeps repeat clean
   * installs fast. Returns null when no command is available (the caller treats that as
   * "no gate").
   */
  async runVerify(
    jobId: string,
    dir: string,
    command: string | null,
  ): Promise<{ ok: boolean; output: string } | null> {
    if (!command || command.trim().length === 0) {
      return null;
    }

    const VERIFY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — clean install + tests/build
    const sandboxMode = this.config.get('SANDBOX_MODE');

    let cacheDir: string | undefined;
    if (sandboxMode === 'default') {
      cacheDir = resolve(this.config.get('WORKSPACE_ROOT'), '.npm-cache');
      await mkdir(cacheDir, { recursive: true });
    }

    const spec = buildVerifySpec({
      sandboxMode,
      dockerImage: this.config.get('DOCKER_AGENT_IMAGE'),
      dir,
      cacheDir,
      command,
      jobId,
    });

    this.logger.log(`[verify] (${sandboxMode}) job ${jobId}: ${command}`);

    const raw = await spawnProcess(spec, { cwd: dir, timeoutMs: VERIFY_TIMEOUT_MS });
    const output = [raw.stdout, raw.stderr]
      .filter((s) => s && s.trim().length > 0)
      .join('\n')
      .trim();

    if (raw.timedOut) {
      return {
        ok: false,
        output: `${output}\n[verify timed out after ${VERIFY_TIMEOUT_MS / 1000}s]`,
      };
    }

    return { ok: raw.exitCode === 0, output };
  }

  async cleanup(jobId: string): Promise<void> {
    const dir = workspaceDir(this.config.get('WORKSPACE_ROOT'), jobId);

    await rm(dir, { recursive: true, force: true });
  }

  /** Returns the absolute path of the job's workspace directory. */
  dir(jobId: string): string {
    return workspaceDir(this.config.get('WORKSPACE_ROOT'), jobId);
  }

  /**
   * Downloads GitHub-hosted attachments into a `.attachments/` sub-directory of the
   * workspace. Skips files already present (idempotent across phases). Returns the set of
   * successfully downloaded files with their workspace-relative paths.
   */
  async downloadAttachments(
    dir: string,
    installationId: number,
    refs: AttachmentRef[],
  ): Promise<DownloadedAttachment[]> {
    if (refs.length === 0) {
      return [];
    }
    const token = await this.app.getInstallationToken(installationId);
    const attachDir = join(dir, '.attachments');

    await mkdir(attachDir, { recursive: true });

    const results: DownloadedAttachment[] = [];

    for (const ref of refs) {
      const dest = join(attachDir, ref.filename);
      const relativePath = `.attachments/${ref.filename}`;

      if (existsSync(dest)) {
        results.push({ filename: ref.filename, relativePath });

        continue;
      }

      try {
        const response = await fetch(ref.url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          this.logger.warn(`attachment download failed (${response.status}): ${ref.url}`);

          continue;
        }

        await writeFile(dest, Buffer.from(await response.arrayBuffer()));

        results.push({ filename: ref.filename, relativePath });

        this.logger.log(`downloaded attachment ${ref.filename} for workspace ${dir}`);
      } catch (e) {
        this.logger.warn(`attachment download error: ${(e as Error).message}`);
      }
    }

    return results;
  }

  private async configureIdentity(git: SimpleGit): Promise<void> {
    await git.addConfig('user.name', this.config.get('GIT_AUTHOR_NAME'));
    await git.addConfig('user.email', this.config.get('GIT_AUTHOR_EMAIL'));
  }

  private async defaultBranch(git: SimpleGit): Promise<string> {
    try {
      const ref = await git.revparse(['--abbrev-ref', 'origin/HEAD']);

      return ref.trim().replace(/^origin\//, '') || 'main';
    } catch {
      return 'main';
    }
  }
}
