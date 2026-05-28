import { Injectable, type OnModuleDestroy, type OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // WAL lets readers and a writer proceed concurrently; busy_timeout makes
    // concurrent writers wait-and-retry instead of failing with SQLITE_BUSY.
    // journal_mode returns a row, so it must go through $queryRawUnsafe.
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
    await this.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
    this.logger.log('Connected to database (SQLite, WAL)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from database');
  }
}
