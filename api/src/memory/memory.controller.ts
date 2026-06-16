import { Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { MemoryService } from './memory.service.js';

@Controller('mcp')
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);
  private readonly server: McpServer;
  private readonly transports = new Map<string, SSEServerTransport>();

  constructor(private readonly memory: MemoryService) {
    this.server = new McpServer({ name: 'olympian-memory', version: '1.0.0' });

    this.server.registerTool(
      'memory_set',
      {
        description:
          'Store a key/value entry for the current job. Use key="plan:<filepath>" and value="pending" at session start for each plan file, then value="done" when complete.',
        inputSchema: { jobId: z.string(), key: z.string(), value: z.string() },
      },
      async ({ jobId, key, value }) => {
        await this.memory.set(jobId, key, value);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      },
    );

    this.server.registerTool(
      'memory_get',
      {
        description:
          'Retrieve stored entries for the current job. Optionally filter by key prefix (e.g. "plan:"). Call this after any context compaction to recover your progress list.',
        inputSchema: { jobId: z.string(), prefix: z.string().optional() },
      },
      async ({ jobId, prefix }) => {
        const entries = await this.memory.get(jobId, prefix);
        return { content: [{ type: 'text' as const, text: JSON.stringify(entries) }] };
      },
    );
  }

  @Get()
  async handleSse(@Req() req: Request, @Res() res: Response): Promise<void> {
    const transport = new SSEServerTransport('/api/mcp/message', res);
    this.transports.set(transport.sessionId, transport);
    req.on('close', () => {
      this.transports.delete(transport.sessionId);
    });
    await this.server.connect(transport);
  }

  @Post('message')
  async handleMessage(
    @Query('sessionId') sessionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const transport = this.transports.get(sessionId);
    if (!transport) {
      this.logger.warn(`MCP session not found: ${sessionId}`);
      res.status(404).json({ error: 'session not found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  }
}
