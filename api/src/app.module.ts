import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { AppConfigService } from './config/config.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { HealthModule } from './health/health.module.js';
import { WorkerModule } from './worker/worker.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { LangfuseModule } from './langfuse/langfuse.module.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'app', 'dist'),
      exclude: ['/api*', '/stream*', '/webhooks*', '/health*', '/metrics*', '/langfuse*'],
    }),
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
export class AppModule {}
