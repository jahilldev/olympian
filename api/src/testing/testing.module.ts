import { Module } from '@nestjs/common';
import { TestingService } from './testing.service.js';

@Module({
  providers: [TestingService],
  exports: [TestingService],
})
export class TestingModule {}
