import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { simpleGit, type SimpleGit } from 'simple-git';
import { AppConfigService } from '../config/config.service.js';
import { GithubAppService } from '../github-app/github-app.service.js';
import { type DiffSummary, type Workspace, type WorkspacePrepareInput } from './workspace.model.js';
import {
  authenticatedRemoteUrl,
  changedFilesFromStatus,
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
    private readonly app: GithubAppService,
  ) {}

  /** Clone (if needed) and check out the job's branch. Idempotent across attempts. */
  async prepare(input: WorkspacePrepareInput): Promise<Workspace> {
    const root = this.config.get('WORKSPACE_ROOT');
    const dir = workspaceDir(root, input.jobId);
    const token = await this.app.getInstallationToken(input.installationId);
    const remote = authenticatedRemoteUrl(input.owner, input.repo, token);

    if (existsSync(`${dir}/.git`)) {
      const git = simpleGit(dir);
      await git.remote(['set-url', 'origin', remote]);
      await git.fetch(['origin']);
      await this.configureIdentity(git);
      const base = input.baseBranch ?? (await this.defaultBranch(git));
      await git.checkout(input.branchName).catch(async () => {
        await git.checkoutBranch(input.branchName, `origin/${base}`);
      });
      return { dir, branch: input.branchName, baseBranch: base };
    }

    await mkdir(root, { recursive: true });
    const git = simpleGit();
    await git.clone(remote, dir, ['--depth', '1', '--no-single-branch']);
    const repoGit = simpleGit(dir);
    await this.configureIdentity(repoGit);
    const base = input.baseBranch ?? (await this.defaultBranch(repoGit));
    await repoGit.checkoutLocalBranch(input.branchName);
    this.logger.log(
      `[job ${input.jobId}] cloned ${input.owner}/${input.repo} -> ${dir} (${input.branchName} from ${base})`,
    );
    return { dir, branch: input.branchName, baseBranch: base };
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

  /** Push the job branch, refreshing the remote token first (tokens expire ~1h). */
  async push(input: WorkspacePrepareInput): Promise<string> {
    const root = this.config.get('WORKSPACE_ROOT');
    const dir = workspaceDir(root, input.jobId);
    const git = simpleGit(dir);
    const token = await this.app.getInstallationToken(input.installationId);
    await git.remote(['set-url', 'origin', authenticatedRemoteUrl(input.owner, input.repo, token)]);
    await git.push(['-u', 'origin', input.branchName]);
    const sha = (await git.revparse(['HEAD'])).trim();
    this.logger.log(`[job ${input.jobId}] pushed ${input.branchName} @ ${sha}`);
    return sha;
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
   * Runs the configured VERIFY_COMMAND (tests/build) in the worktree. Returns null
   * when no command is configured. Used by the implementation loop as an acceptance gate.
   */
  async runVerify(dir: string): Promise<{ ok: boolean; output: string } | null> {
    const command = this.config.get('VERIFY_COMMAND');
    if (!command || command.trim().length === 0) {
      return null;
    }
    return new Promise((resolve) => {
      let output = '';
      const child = spawn('sh', ['-c', command], { cwd: dir, env: process.env });
      const onData = (d: Buffer) => {
        if (output.length < 50_000) {
          output += d.toString();
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) =>
        resolve({ ok: false, output: `${output}\n[spawn error] ${e.message}` }),
      );
      child.on('close', (code) => resolve({ ok: code === 0, output }));
    });
  }

  async cleanup(jobId: string): Promise<void> {
    const dir = workspaceDir(this.config.get('WORKSPACE_ROOT'), jobId);
    await rm(dir, { recursive: true, force: true });
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
