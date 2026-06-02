import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfigService } from '../config/config.service.js';
import { type ReviewResult } from './review.model.js';
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

  async persist(jobId: string, passNumber: number, result: ReviewResult): Promise<void> {
    await this.prisma.reviewPass.upsert({
      where: { jobId_passNumber: { jobId, passNumber } },
      create: {
        jobId,
        passNumber,
        confidence: result.confidence,
        verdict: result.verdict,
        issues: JSON.stringify(result.issues),
      },
      update: {
        confidence: result.confidence,
        verdict: result.verdict,
        issues: JSON.stringify(result.issues),
      },
    });
    await this.prisma.job.update({ where: { id: jobId }, data: { confidence: result.confidence } });
  }

  meetsThreshold(result: ReviewResult): boolean {
    return meetsThreshold(result, this.config.get('REVIEW_CONFIDENCE_THRESHOLD'));
  }

  get threshold(): number {
    return this.config.get('REVIEW_CONFIDENCE_THRESHOLD');
  }

  get maxPasses(): number {
    return this.config.get('MAX_REVIEW_PASSES');
  }
}
