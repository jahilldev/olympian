import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';
import { AppConfigService } from '../config/config.service.js';
import { WebhookService } from './webhook.service.js';
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER } from './webhook.model.js';
import { verifySignature } from './webhook.utility.js';

@Controller('webhooks/github')
export class WebhookController {
  constructor(
    private readonly config: AppConfigService,
    private readonly webhooks: WebhookService,
  ) {}

  @Post()
  @HttpCode(202)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(EVENT_HEADER) event: string,
    @Headers(DELIVERY_HEADER) delivery: string,
    @Headers(SIGNATURE_HEADER) signature: string,
  ): Promise<{ ok: true }> {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) {
      throw new BadRequestException('missing raw body');
    }
    const valid = verifySignature(this.config.get('GITHUB_WEBHOOK_SECRET'), raw, signature);
    if (!valid) {
      throw new UnauthorizedException('invalid signature');
    }
    if (!event || !delivery) {
      throw new BadRequestException('missing event or delivery headers');
    }
    await this.webhooks.handle(event, delivery, raw, req.body as unknown);
    return { ok: true };
  }
}
