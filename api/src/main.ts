import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Populates req.rawBody (Buffer) so the webhook controller can verify the HMAC signature.
    rawBody: true,
  });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  // Parse application/x-protobuf bodies as raw Buffer for the OTLP ingestion endpoint.
  // NestJS's rawBody option only captures bodies handled by the JSON/urlencoded parsers,
  // so protobuf payloads must be explicitly captured here before the route handler runs.
  app.use(
    '/langfuse/api/public/otel/v1/traces',
    raw({ type: 'application/x-protobuf', limit: '50mb' }),
  );

  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`Hermes orchestrator listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
