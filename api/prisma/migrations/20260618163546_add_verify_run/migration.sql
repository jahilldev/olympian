-- CreateTable
CREATE TABLE "VerifyRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "output" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerifyRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VerifyRun_jobId_idx" ON "VerifyRun"("jobId");
