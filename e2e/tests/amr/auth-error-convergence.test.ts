// @vitest-environment node

import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { seedVelaLoginConfig, writeFakeVelaBin } from '@/amr';
import { createAmrProject, putAmrAppConfig } from '@/vitest/amr';
import { listMessages } from '@/vitest/messages';
import { readRunEvents, startRun, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/smoke-suite';

describe('AMR auth error convergence', () => {
  test('marks the run and assistant message as failed when fake vela returns an auth error during prompt', { timeout: 180_000 }, async () => {
    const suite = await createSmokeSuite('amr-auth-error-convergence');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const homeDir = join(suite.scratchDir, 'home');
      const velaBin = await writeFakeVelaBin(join(suite.scratchDir, 'fake-vela-auth-error'), {
        failAuthAtPrompt: true,
      });
      await seedVelaLoginConfig(homeDir, { email: 'auth-error@example.com', profile: 'local' });

      await putAmrAppConfig(webUrl, {
        agentId: 'amr',
        agentCliEnv: {
          amr: {
            VELA_BIN: velaBin,
          },
        },
      });

      const project = await createAmrProject(webUrl, 'AMR auth error convergence');
      const assistantMessageId = `assistant-${Date.now()}`;

      const run = await startRun(webUrl, {
        agentId: 'amr',
        assistantMessageId,
        clientRequestId: `req-${Date.now()}`,
        conversationId: project.conversationId,
        designSystemId: null,
        message: 'Simulate an AMR auth expiry during session/prompt.',
        model: 'default',
        projectId: project.project.id,
        reasoning: 'default',
        skillId: null,
      });

      const terminal = await waitForRunTerminal(webUrl, run.runId, { timeoutMs: 20_000 });
      expect(terminal.status).toBe('failed');

      const messages = await listMessages(webUrl, project.project.id, project.conversationId);
      const assistant = messages.find((message) => message.id === assistantMessageId);
      expect(assistant?.runStatus).toBe('failed');
      await expect(readRunEvents(webUrl, run.runId)).resolves.toMatch(/sign in again/i);
    });
  });
});
