// @vitest-environment node

import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { seedVelaLoginConfig, writeFakeVelaBin } from '@/amr';
import { createAmrProject, putAmrAppConfig } from '@/vitest/amr';
import { requestJson } from '@/vitest/http';
import { readRunEvents, startRun, waitForRunStatus, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/smoke-suite';

describe('AMR logout state persistence', () => {
  test('a previously working AMR session stops working after local logout and requires re-login', { timeout: 180_000 }, async () => {
    const suite = await createSmokeSuite('amr-logout-state-persistence');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const homeDir = join(suite.scratchDir, 'home');
      const successVelaBin = await writeFakeVelaBin(join(suite.scratchDir, 'fake-vela-logout-success'), {
        assistantText: 'AMR logout persistence success',
        requireLoginConfig: false,
      });
      const strictVelaBin = await writeFakeVelaBin(join(suite.scratchDir, 'fake-vela-logout-strict'), {
        assistantText: 'AMR logout persistence strict',
      });
      await seedVelaLoginConfig(homeDir, { email: 'logout-state@example.com', profile: 'local' });

      await putAmrAppConfig(webUrl, {
        agentId: 'amr',
        agentCliEnv: {
          amr: {
            VELA_BIN: successVelaBin,
          },
        },
      });

      const project = await createAmrProject(webUrl, 'AMR logout state persistence');

      const firstRun = await startRun(webUrl, {
        agentId: 'amr',
        assistantMessageId: `assistant-success-${Date.now()}`,
        clientRequestId: `req-success-${Date.now()}`,
        conversationId: project.conversationId,
        designSystemId: null,
        message: 'First AMR run should succeed before logout.',
        model: 'default',
        projectId: project.project.id,
        reasoning: 'default',
        skillId: null,
      });
      await waitForRunStatus(webUrl, firstRun.runId, 'succeeded', { timeoutMs: 20_000 });

      await requestJson(webUrl, '/api/integrations/vela/logout', { body: {}, method: 'POST' });
      const status = await requestJson<{ loggedIn: boolean }>(webUrl, '/api/integrations/vela/status');
      expect(status.loggedIn).toBe(false);

      await putAmrAppConfig(webUrl, {
        agentId: 'amr',
        agentCliEnv: {
          amr: {
            VELA_BIN: strictVelaBin,
          },
        },
      });

      const secondRun = await startRun(webUrl, {
        agentId: 'amr',
        assistantMessageId: `assistant-fail-${Date.now()}`,
        clientRequestId: `req-fail-${Date.now()}`,
        conversationId: project.conversationId,
        designSystemId: null,
        message: 'Second AMR run should require login again.',
        model: 'default',
        projectId: project.project.id,
        reasoning: 'default',
        skillId: null,
      });
      const terminal = await waitForRunTerminal(webUrl, secondRun.runId, { timeoutMs: 20_000 });
      expect(terminal.status).toBe('failed');

      await expect(readRunEvents(webUrl, secondRun.runId)).resolves.toMatch(/sign in again|login missing|expired/i);
    });
  });
});
