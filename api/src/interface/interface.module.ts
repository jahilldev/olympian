import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InterfaceController } from './interface.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [InterfaceController],
})
export class InterfaceModule {}
