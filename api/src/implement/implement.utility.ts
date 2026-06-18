export function implementCommitMessage(
  issueNumber: number,
  title: string,
  attempt: number,
): string {
  return (
    `feat: resolve #${issueNumber} ${title}`.slice(0, 72) +
    (attempt > 1 ? ` (attempt ${attempt})` : '')
  );
}
