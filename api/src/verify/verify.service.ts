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

  /** Verify attempts already recorded for a cycle — used to cap the VERIFY→REVISE loop. */
  countForCycle(jobId: string, cycle: number): Promise<number> {
    return this.prisma.verifyRun.count({ where: { jobId, cycle } });
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
