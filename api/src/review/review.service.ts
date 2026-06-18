import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { type ReviewPassDto, type ReviewResult } from './review.model.js';
import { meetsThreshold } from './review.utility.js';

/**
 * Persists review passes and applies the confidence-threshold policy that gates
 * whether a job may open its PR.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async persist(opts: {
    jobId: string;
    cycle: number;
    passNumber: number;
    result: ReviewResult;
  }): Promise<void> {
    const { jobId, cycle, passNumber, result } = opts;

    const fields = {
      confidence: result.confidence,
      verdict: result.verdict,
      dimensions: JSON.stringify(result.dimensions),
      verifyOk: result.verifyOk,
      issues: JSON.stringify(result.issues),
    };

    await this.prisma.reviewPass.upsert({
      where: { jobId_cycle_passNumber: { jobId, cycle, passNumber } },
      create: { jobId, cycle, passNumber, ...fields },
      update: fields,
    });

    await this.prisma.job.update({ where: { id: jobId }, data: { confidence: result.confidence } });
  }

  meetsThreshold(result: ReviewResult): boolean {
    return meetsThreshold(result);
  }

  get threshold(): number {
    return this.config.get('REVIEW_CONFIDENCE_THRESHOLD');
  }

  get maxPasses(): number {
    return this.config.get('MAX_REVIEW_PASSES');
  }

  async listForJob(jobId: string): Promise<ReviewPassDto[]> {
    const rows = await this.prisma.reviewPass.findMany({
      where: { jobId },
      orderBy: [{ cycle: 'asc' }, { passNumber: 'asc' }],
    });

    return rows.map((r) => {
      let issues: ReviewPassDto['issues'] = [];

      try {
        issues = JSON.parse(r.issues) as ReviewPassDto['issues'];
      } catch {
        // malformed stored JSON — return empty array
      }

      let dimensions: ReviewPassDto['dimensions'] = null;

      try {
        dimensions = r.dimensions
          ? (JSON.parse(r.dimensions) as ReviewPassDto['dimensions'])
          : null;
      } catch {
        // malformed stored JSON — leave null
      }

      return {
        id: r.id,
        cycle: r.cycle,
        passNumber: r.passNumber,
        confidence: r.confidence,
        verdict: r.verdict as ReviewPassDto['verdict'],
        dimensions,
        verifyOk: r.verifyOk,
        issues,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
