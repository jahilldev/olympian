/*
  Warnings:

  - You are about to drop the `PrRevisionFeedback` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PrRevisionFeedback";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "PullRequestFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "path" TEXT,
    "line" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PullRequestFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRecords" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PullRequestFeedback_jobId_idx" ON "PullRequestFeedback"("jobId");
