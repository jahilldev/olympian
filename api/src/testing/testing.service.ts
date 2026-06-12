import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service.js';
import { type TestResult } from './testing.model.js';
import { formatTestFailures, parseTestResult } from './testing.utility.js';

/**
 * Owns the TEST phase policy: structured verdict parsing, failure formatting, and
 * the iteration cap that prevents the TEST→REVISE loop from running indefinitely.
 */
@Injectable()
export class TestingService {
  constructor(private readonly config: AppConfigService) {}

  get maxIterations(): number {
    return this.config.get('MAX_TEST_ITERATIONS');
  }

  parse(stdout: string): TestResult | null {
    return parseTestResult(stdout);
  }

  formatFailures(result: TestResult): string {
    return formatTestFailures(result);
  }
}
