import { jest } from '@jest/globals';
import { ChatService } from './chat.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfigService } from '../config/config.service.js';
import type { HermesAgentService } from '../agent/agent.service.js';
import type { WorkspaceService } from '../workspace/workspace.service.js';

const resolved = (value: unknown) => jest.fn((..._args: unknown[]) => Promise.resolve(value));

function setup(overrides: { session?: Record<string, unknown> | null } = {}) {
  const session =
    overrides.session === null
      ? null
      : {
          id: 'sess1',
          title: 'Chat',
          repoUrl: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          ...overrides.session,
        };

  const prisma = {
    chatSession: {
      create: resolved({ id: 'sess1' }),
      findUnique: resolved(session),
      findMany: resolved([]),
      update: resolved(session),
    },
    chatMessage: {
      create: resolved(undefined),
      findMany: resolved([{ role: 'user', content: 'hello' }]),
    },
  };

  const config = { get: jest.fn((k: string) => (k === 'WORKER_CONCURRENCY' ? 2 : undefined)) };

  // agent.run invokes onStart with the new run id, then resolves like a finished run.
  const agent = {
    run: jest.fn((opts: { onStart?: (id: string) => void }) => {
      opts.onStart?.('run-chat-1');
      return Promise.resolve({
        runId: 'run-chat-1',
        status: 'SUCCEEDED',
        stdout: 'Hi there!',
        stderr: '',
        exitCode: 0,
        durationMs: 5,
      });
    }),
  };

  const workspace = {
    prepare: resolved({ dir: '/tmp/chat-sess1', branch: 'chat-sess1', baseBranch: 'main' }),
  };

  const service = new ChatService(
    prisma as unknown as PrismaService,
    config as unknown as AppConfigService,
    agent as unknown as HermesAgentService,
    workspace as unknown as WorkspaceService,
  );

  return { service, prisma, agent, workspace };
}

describe('ChatService', () => {
  it('createSession defaults the title and returns the id', async () => {
    const { service, prisma } = setup();

    const res = await service.createSession({});

    expect(res).toEqual({ id: 'sess1' });
    expect(prisma.chatSession.create).toHaveBeenCalled();
  });

  it('sendMessage persists the user message, runs the agent, and returns the runId', async () => {
    const { service, prisma, agent, workspace } = setup();

    const res = await service.sendMessage('sess1', 'hello');

    expect(res).toEqual({ runId: 'run-chat-1' });
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'user', content: 'hello' }),
      }),
    );
    expect(workspace.prepare).toHaveBeenCalled();
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess1', phase: 'CHAT' }),
    );
  });

  it('sendMessage throws when the session does not exist', async () => {
    const { service } = setup({ session: null });

    await expect(service.sendMessage('missing', 'hi')).rejects.toThrow();
  });
});
