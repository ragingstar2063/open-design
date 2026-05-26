// @vitest-environment node

import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { writeFakeVelaBin } from '@/amr';
import { createAmrProject, putAmrAppConfig } from '@/vitest/amr';
import { readRunEvents, startRun, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/smoke-suite';

describe('AMR relogin-required run failures', () => {
  test('fails a new /api/runs request when the local AMR login config is missing', { timeout: 180_000 }, async () => {
    const suite = await createSmokeSuite('amr-relogin-required');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const velaBin = await writeFakeVelaBin(join(suite.scratchDir, 'fake-vela-missing-login'));

      await putAmrAppConfig(webUrl, {
        agentId: 'amr',
        agentCliEnv: {
          amr: {
            VELA_BIN: velaBin,
          },
        },
      });

      const project = await createAmrProject(webUrl, 'AMR relogin required');

      const assistantMessageId = `assistant-${Date.now()}`;
      const run = await startRun(webUrl, {
        agentId: 'amr',
        assistantMessageId,
        clientRequestId: `req-${Date.now()}`,
        conversationId: project.conversationId,
        designSystemId: null,
        message: 'This should require a fresh AMR login.',
        model: 'default',
        projectId: project.project.id,
        reasoning: 'default',
        skillId: null,
      });
      const terminal = await waitForRunTerminal(webUrl, run.runId, { timeoutMs: 20_000 });
      expect(terminal.status).toBe('failed');

      await expect(readRunEvents(webUrl, run.runId)).resolves.toMatch(/sign in again|login missing|expired/i);
    });
  });
});
