interface JobSource {
  origin: string;
  repoFullName: string | null;
  issueNumber: number | null;
  repoUrl: string | null;
}

/** Owner/repo from an SSH remote (git@host:owner/repo.git or ssh://host/owner/repo.git). */
export function shortRepoUrl(url: string): string {
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1] : url;
}

/** Short human label for where a job came from — GitHub issue ref or dashboard repo. */
export function jobSourceLabel(job: JobSource): string {
  if (job.origin === 'DASHBOARD') {
    return job.repoUrl ? shortRepoUrl(job.repoUrl) : 'dashboard';
  }
  return `${job.repoFullName} #${job.issueNumber}`;
}

/** GitHub issue URL for a job, or null for dashboard jobs (no issue to link). */
export function jobIssueUrl(job: JobSource): string | null {
  if (job.origin === 'DASHBOARD' || !job.repoFullName || job.issueNumber === null) {
    return null;
  }
  return `https://github.com/${job.repoFullName}/issues/${job.issueNumber}`;
}
