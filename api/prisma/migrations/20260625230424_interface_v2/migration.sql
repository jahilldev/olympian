-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "repoUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "agentRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "AgentRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentRun" ("command", "createdAt", "cwd", "durationMs", "exitCode", "id", "jobId", "judgePassed", "model", "phase", "status", "stderr", "stdout") SELECT "command", "createdAt", "cwd", "durationMs", "exitCode", "id", "jobId", "judgePassed", "model", "phase", "status", "stderr", "stdout" FROM "AgentRun";
DROP TABLE "AgentRun";
ALTER TABLE "new_AgentRun" RENAME TO "AgentRun";
CREATE INDEX "AgentRun_jobId_idx" ON "AgentRun"("jobId");
CREATE INDEX "AgentRun_sessionId_idx" ON "AgentRun"("sessionId");
CREATE TABLE "new_Job" (
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
    CONSTRAINT "Job_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "RepoInstallation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("attempts", "branchName", "confidence", "createdAt", "error", "headSha", "id", "installationId", "issueBody", "issueNumber", "issueTitle", "prNumber", "repoFullName", "repoName", "repoOwner", "reviewCycle", "state", "triggerLabel", "updatedAt", "verifyCommand") SELECT "attempts", "branchName", "confidence", "createdAt", "error", "headSha", "id", "installationId", "issueBody", "issueNumber", "issueTitle", "prNumber", "repoFullName", "repoName", "repoOwner", "reviewCycle", "state", "triggerLabel", "updatedAt", "verifyCommand" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_state_idx" ON "Job"("state");
CREATE INDEX "Job_repoFullName_state_idx" ON "Job"("repoFullName", "state");
CREATE UNIQUE INDEX "Job_repoFullName_issueNumber_key" ON "Job"("repoFullName", "issueNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");
