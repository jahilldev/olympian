/*
  Warnings:

  - You are about to drop the `Job` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PullRequestRef` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "Job_repoFullName_issueNumber_key";

-- DropIndex
DROP INDEX "Job_repoFullName_state_idx";

-- DropIndex
DROP INDEX "Job_state_idx";

-- DropIndex
DROP INDEX "PullRequestRef_jobId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Job";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PullRequestRef";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "JobRecords" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT,
    "repoOwner" TEXT,
    "repoName" TEXT,
    "repoFullName" TEXT,
    "issueNumber" INTEGER,
    "issueTitle" TEXT NOT NULL,
    "issueBody" TEXT NOT NULL,
    "triggerLabel" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'GITHUB',
    "repoUrl" TEXT,
    "state" TEXT NOT NULL DEFAULT 'TRIAGED',
    "branchName" TEXT,
    "prNumber" INTEGER,
    "headSha" TEXT,
    "confidence" INTEGER,
    "verifyCommand" TEXT,
    "reviewCycle" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobRecords_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "RepoInstallation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "headSha" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PullRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT,
    "sessionId" TEXT,
    "phase" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "cwd" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "durationMs" INTEGER,
    "judgePassed" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentRun" ("command", "createdAt", "cwd", "durationMs", "exitCode", "id", "jobId", "judgePassed", "model", "phase", "sessionId", "status", "stderr", "stdout") SELECT "command", "createdAt", "cwd", "durationMs", "exitCode", "id", "jobId", "judgePassed", "model", "phase", "sessionId", "status", "stderr", "stdout" FROM "AgentRun";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE INDEX "AgentRun_jobId_idx" ON "AgentRun"("jobId");
CREATE INDEX "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");
CREATE TABLE "new_JobStateTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobStateTransition_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_JobStateTransition" ("actor", "createdAt", "fromState", "id", "jobId", "reason", "toState") SELECT "actor", "createdAt", "fromState", "id", "jobId", "reason", "toState" FROM "JobStateTransition";
DROP TABLE "JobStateTransition";
ALTER TABLE "new_JobStateTransition" RENAME TO "JobStateTransition";
CREATE INDEX "JobStateTransition_jobId_idx" ON "JobStateTransition"("jobId");
CREATE TABLE "new_PlanFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "githubCommentId" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlanFeedback" ("author", "body", "createdAt", "githubCommentId", "id", "jobId") SELECT "author", "body", "createdAt", "githubCommentId", "id", "jobId" FROM "PlanFeedback";
DROP TABLE "PlanFeedback";
ALTER TABLE "new_PlanFeedback" RENAME TO "PlanFeedback";
CREATE INDEX "PlanFeedback_jobId_idx" ON "PlanFeedback"("jobId");
CREATE TABLE "new_PlanRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "githubCommentId" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanRevision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlanRevision" ("content", "createdAt", "githubCommentId", "id", "jobId", "revision", "status") SELECT "content", "createdAt", "githubCommentId", "id", "jobId", "revision", "status" FROM "PlanRevision";
DROP TABLE "PlanRevision";
ALTER TABLE "new_PlanRevision" RENAME TO "PlanRevision";
CREATE INDEX "PlanRevision_jobId_idx" ON "PlanRevision"("jobId");
CREATE UNIQUE INDEX "PlanRevision_jobId_revision_key" ON "PlanRevision"("jobId", "revision");
CREATE TABLE "new_PrRevisionFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "path" TEXT,
    "line" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrRevisionFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PrRevisionFeedback" ("author", "body", "createdAt", "id", "jobId", "line", "path") SELECT "author", "body", "createdAt", "id", "jobId", "line", "path" FROM "PrRevisionFeedback";
DROP TABLE "PrRevisionFeedback";
ALTER TABLE "new_PrRevisionFeedback" RENAME TO "PrRevisionFeedback";
CREATE INDEX "PrRevisionFeedback_jobId_idx" ON "PrRevisionFeedback"("jobId");
CREATE TABLE "new_QueueTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QueueTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_QueueTask" ("attempts", "createdAt", "id", "jobId", "kind", "lastError", "lockedAt", "lockedBy", "maxAttempts", "priority", "runAt", "status", "updatedAt") SELECT "attempts", "createdAt", "id", "jobId", "kind", "lastError", "lockedAt", "lockedBy", "maxAttempts", "priority", "runAt", "status", "updatedAt" FROM "QueueTask";
DROP TABLE "QueueTask";
ALTER TABLE "new_QueueTask" RENAME TO "QueueTask";
CREATE INDEX "QueueTask_status_runAt_idx" ON "QueueTask"("status", "runAt");
CREATE INDEX "QueueTask_jobId_idx" ON "QueueTask"("jobId");
CREATE TABLE "new_ReviewPass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "passNumber" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "dimensions" TEXT,
    "verifyOk" BOOLEAN,
    "issues" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewPass_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReviewPass" ("confidence", "createdAt", "cycle", "dimensions", "id", "issues", "jobId", "passNumber", "verdict", "verifyOk") SELECT "confidence", "createdAt", "cycle", "dimensions", "id", "issues", "jobId", "passNumber", "verdict", "verifyOk" FROM "ReviewPass";
DROP TABLE "ReviewPass";
ALTER TABLE "new_ReviewPass" RENAME TO "ReviewPass";
CREATE INDEX "ReviewPass_jobId_idx" ON "ReviewPass"("jobId");
CREATE UNIQUE INDEX "ReviewPass_jobId_cycle_passNumber_key" ON "ReviewPass"("jobId", "cycle", "passNumber");
CREATE TABLE "new_VerifyRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "output" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerifyRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VerifyRun" ("attempt", "command", "createdAt", "cycle", "durationMs", "id", "jobId", "ok", "output") SELECT "attempt", "command", "createdAt", "cycle", "durationMs", "id", "jobId", "ok", "output" FROM "VerifyRun";
DROP TABLE "VerifyRun";
ALTER TABLE "new_VerifyRun" RENAME TO "VerifyRun";
CREATE INDEX "VerifyRun_jobId_idx" ON "VerifyRun"("jobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "JobRecords_state_idx" ON "JobRecords"("state");

-- CreateIndex
CREATE INDEX "JobRecords_repoFullName_state_idx" ON "JobRecords"("repoFullName", "state");

-- CreateIndex
CREATE UNIQUE INDEX "JobRecords_repoFullName_issueNumber_key" ON "JobRecords"("repoFullName", "issueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_jobId_key" ON "PullRequest"("jobId");
