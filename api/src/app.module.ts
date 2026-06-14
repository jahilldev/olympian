import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { static as serveStatic } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ConfigModule } from './config/config.module.js';
import { AppConfigService } from './config/config.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { HealthModule } from './health/health.module.js';
import { WorkerModule } from './worker/worker.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { LangfuseModule } from './langfuse/langfuse.module.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distPath = join(__dirname, '..', '..', 'app', 'dist');
const staticHandler = serveStatic(distPath);

// Middleware registered via configure() runs before NestJS route matching, so it
// can serve the correct page shell for each route without conflicting with the
// /api global prefix that the controller routes live under.
function spaMiddleware(req: Request, res: Response, next: NextFunction): void {
  staticHandler(req, res, () => {
    if (
      req.method !== 'GET' ||
      req.path.startsWith('/api/') ||
      req.path.startsWith('/stream/') ||
      req.path.startsWith('/webhooks/') ||
      req.path.startsWith('/langfuse/')
    ) {
      return next();
    }

    const p = req.path;

    // /jobs/:id/runs/:runId  →  run output page
    if (/^\/jobs\/[^/]+\/runs\/[^/]/.test(p)) {
      return res.sendFile(join(distPath, 'jobs', 'runs', 'index.html'));
    }

    // /jobs/:id  →  job detail page
    if (/^\/jobs\/[^/]/.test(p)) {
      return res.sendFile(join(distPath, 'jobs', 'index.html'));
    }

    // Everything else (/, /sw.js, /manifest.webmanifest, …)
    res.sendFile(join(distPath, 'index.html'));
  });
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
          redact: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]'],
          transport: config.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    MetricsModule,
    HealthModule,
    WebhookModule,
    WorkerModule,
    LangfuseModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(spaMiddleware).forRoutes('*');
  }
}
