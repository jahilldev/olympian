-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "issueNumber" INTEGER NOT NULL,
    "issueTitle" TEXT NOT NULL,
    "issueBody" TEXT NOT NULL,
    "triggerLabel" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'TRIAGED',
    "branchName" TEXT,
    "prNumber" INTEGER,
    "headSha" TEXT,
    "confidence" INTEGER,
    "reviewCycle" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "RepoInstallation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("attempts", "branchName", "confidence", "createdAt", "error", "headSha", "id", "installationId", "issueBody", "issueNumber", "issueTitle", "prNumber", "repoFullName", "repoName", "repoOwner", "state", "triggerLabel", "updatedAt") SELECT "attempts", "branchName", "confidence", "createdAt", "error", "headSha", "id", "installationId", "issueBody", "issueNumber", "issueTitle", "prNumber", "repoFullName", "repoName", "repoOwner", "state", "triggerLabel", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_state_idx" ON "Job"("state");
CREATE INDEX "Job_repoFullName_state_idx" ON "Job"("repoFullName", "state");
CREATE UNIQUE INDEX "Job_repoFullName_issueNumber_key" ON "Job"("repoFullName", "issueNumber");
CREATE TABLE "new_ReviewPass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "passNumber" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "issues" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewPass_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReviewPass" ("confidence", "createdAt", "id", "issues", "jobId", "passNumber", "verdict") SELECT "confidence", "createdAt", "id", "issues", "jobId", "passNumber", "verdict" FROM "ReviewPass";
DROP TABLE "ReviewPass";
ALTER TABLE "new_ReviewPass" RENAME TO "ReviewPass";
CREATE INDEX "ReviewPass_jobId_idx" ON "ReviewPass"("jobId");
CREATE UNIQUE INDEX "ReviewPass_jobId_cycle_passNumber_key" ON "ReviewPass"("jobId", "cycle", "passNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
