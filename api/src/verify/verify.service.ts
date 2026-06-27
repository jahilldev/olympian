import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { VERIFY_OUTPUT_CAP, type RecordVerifyInput, type VerifyRunDto } from './verify.model.js';
import { toDto } from './verify.utility.js';

/**
 * Persists VERIFY-stage executions (the orchestrator-run tests/build command) so the
 * verify outcome is auditable and visible in the UI — explaining why a job looped
 * back to REVISE.
 */
@Injectable()
export class VerifyService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordVerifyInput): Promise<void> {
    await this.prisma.verifyRun.create({
      data: {
        jobId: input.jobId,
        cycle: input.cycle,
        attempt: input.attempt,
        command: input.command,
        ok: input.ok,
        output: input.output.slice(0, VERIFY_OUTPUT_CAP),
        durationMs: input.durationMs,
      },
    });
  }

  /** Total verify attempts recorded for a cycle — used for the human-facing attempt number. */
  countForCycle(jobId: string, cycle: number): Promise<number> {
    return this.prisma.verifyRun.count({ where: { jobId, cycle } });
  }

  /**
   * FAILED verify attempts in a cycle — the cap for the VERIFY→REVISE fix loop. A cycle can also
   * contain passing re-verifies (after review passes); those must NOT consume the fix budget, so
   * the cap counts failures only, not total verifies.
   */
  countFailedForCycle(jobId: string, cycle: number): Promise<number> {
    return this.prisma.verifyRun.count({ where: { jobId, cycle, ok: false } });
  }

  async listForJob(jobId: string): Promise<VerifyRunDto[]> {
    const rows = await this.prisma.verifyRun.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toDto);
  }

  async get(id: string): Promise<VerifyRunDto | null> {
    const row = await this.prisma.verifyRun.findUnique({ where: { id } });

    return row ? toDto(row) : null;
  }
}
