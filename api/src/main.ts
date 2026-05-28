import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`Hermes orchestrator listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
