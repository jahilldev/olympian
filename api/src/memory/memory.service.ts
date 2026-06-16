import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { type MemoryEntry } from './memory.model.js';

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async set(jobId: string, key: string, value: string): Promise<void> {
    await this.prisma.agentMemory.upsert({
      where: { jobId_key: { jobId, key } },
      create: { jobId, key, value },
      update: { value },
    });
  }

  async get(jobId: string, prefix?: string): Promise<MemoryEntry[]> {
    return this.prisma.agentMemory.findMany({
      where: {
        jobId,
        ...(prefix ? { key: { startsWith: prefix } } : {}),
      },
      orderBy: { key: 'asc' },
      select: { key: true, value: true, updatedAt: true },
    });
  }

  async clear(jobId: string): Promise<void> {
    await this.prisma.agentMemory.deleteMany({ where: { jobId } });
  }
}
