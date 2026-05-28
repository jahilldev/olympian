import { Controller, Get, Header, Res } from '@nestjs/common';
import { type Response } from 'express';
import { MetricsService } from './metrics.service.js';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    const { contentType, body } = await this.metrics.render();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
