import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly service: HealthService,
  ) {}

  // Liveness: the process is running and able to respond.
  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  // Readiness: dependencies (database) are reachable.
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.service.checkDatabase()]);
  }
}
