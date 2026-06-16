import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { MemoryService } from './memory.service.js';

@Controller('mcp')
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);
  private readonly server: McpServer;

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

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    await this.server.connect(transport);

    await transport.handleRequest(req, res, (req as Request & { body: unknown }).body);

    await transport.close();
  }
}
