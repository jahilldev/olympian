-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AgentMemory_jobId_idx" ON "AgentMemory"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemory_jobId_key_key" ON "AgentMemory"("jobId", "key");
