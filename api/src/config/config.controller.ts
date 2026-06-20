import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from './config.service.js';

@Controller('config')
export class ConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  getConfig() {
    return {
      contextLength: this.config.get('HERMES_CONTEXT_LENGTH'),
      compressionThreshold: this.config.get('HERMES_COMPRESS_THRESHOLD'),
      auxiliaryModel: this.config.get('HERMES_AUXILIARY_MODEL') || null,
    };
  }
}
