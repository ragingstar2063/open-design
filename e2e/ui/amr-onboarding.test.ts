import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { dismissPrivacyDialog, STORAGE_KEY, waitForLoadingToClear } from '@/playwright/amr';

type OnboardingConfig = {
  mode: 'daemon';
  apiKey: string;
  baseUrl: string;
  model: string;
  agentId: string | null;
  skillId: null;
  designSystemId: null;
  onboardingCompleted: boolean;
  mediaProviders: Record<string, never>;
  agentModels: Record<string, { model: string; reasoning: string }>;
};

test.describe.configure({ timeout: 30_000 });

test('[P0] onboarding lets AMR Cloud sign in and continue after the login poll succeeds', async ({ page }) => {
  const config = await wireOnboardingMocks(page, {
    amrAvailable: true,
    initialLoggedIn: false,
  });

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: config },
  );

  await gotoOnboarding(page);

  const continueButton = page.getByRole('button', { name: /sign in to continue/i });
  await expect(continueButton).toBeVisible();
  await continueButton.click();

  await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible({ timeout: 10_000 });
});

test('[P0] onboarding Local CLI card lets the user search agent models before continuing', async ({ page }) => {
  const config = await wireOnboardingMocks(page, {
    amrAvailable: false,
    initialLoggedIn: false,
    codexModels: [
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'o3', label: 'o3' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'glm-5', label: 'GLM 5' },
      { id: 'qwen3-235b', label: 'Qwen3 235B' },
      { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'kimi-k2.6', label: 'Kimi K2.6' },
    ],
  });

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: config },
  );

  await gotoOnboarding(page);

  await page.getByRole('button', { name: /Local coding agent/i }).click();
  const localCliPanel = page.locator('.onboarding-view__setup-panel');
  const modelPicker = localCliPanel.getByRole('combobox', { name: /Model/i });
  await modelPicker.click();
  const popover = page.getByTestId('onboarding-cli-model-popover');
  await popover.getByTestId('onboarding-cli-model-search').fill('glm');
  await popover.getByRole('option', { name: 'GLM 5' }).click();

  await expect(modelPicker).toContainText('GLM 5');
  await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible();
});

test('[P0] onboarding falls back to Local CLI when AMR is unavailable', async ({ page }) => {
  const config = await wireOnboardingMocks(page, {
    amrAvailable: false,
    initialLoggedIn: false,
  });

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: config },
  );

  await gotoOnboarding(page);

  await expect(page.getByRole('button', { name: /AMR Cloud/i })).toHaveCount(0);
  await page.getByRole('button', { name: /Local coding agent/i }).click();
  await expect(page.getByText('Local CLI')).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible();
});

test('[P0] onboarding recovers from a transient AMR status failure and still continues after login completes', async ({ page }) => {
  const config = await wireOnboardingMocks(page, {
    amrAvailable: true,
    initialLoggedIn: false,
    failFirstStatusPollAfterLogin: true,
  });

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: config },
  );

  await gotoOnboarding(page);

  await page.getByRole('button', { name: /sign in to continue/i }).click();

  await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible({ timeout: 12_000 });
});

test('[P0] onboarding AMR card lets the user search live models before continuing', async ({ page }) => {
  const config = await wireOnboardingMocks(page, {
    amrAvailable: true,
    initialLoggedIn: true,
    amrModels: [
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
      { id: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'glm-5', label: 'GLM 5' },
      { id: 'qwen3-235b', label: 'Qwen3 235B' },
    ],
  });

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: config },
  );

  await gotoOnboarding(page);

  const amrCard = page.locator('.onboarding-view__amr-cloud-card');
  const modelPicker = amrCard.getByRole('combobox', { name: /Model.*AMR CLI/i });
  await modelPicker.click();
  const popover = page.getByTestId('onboarding-amr-model-popover');
  await expect(popover).toBeVisible();
  const search = page.getByTestId('onboarding-amr-model-search');
  if ((await search.count()) > 0) {
    await expect(search).toBeVisible();
    await search.fill('glm');
  }
  await popover.getByRole('option', { name: 'GLM 5' }).click();

  await expect(modelPicker).toContainText('GLM 5');
  await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible();
});

async function wireOnboardingMocks(
  page: Page,
  options: {
    amrAvailable: boolean;
    initialLoggedIn: boolean;
    failFirstStatusPollAfterLogin?: boolean;
    amrModels?: Array<{ id: string; label: string }>;
    codexModels?: Array<{ id: string; label: string }>;
  },
): Promise<OnboardingConfig> {
  const config: OnboardingConfig = {
    mode: 'daemon',
    apiKey: '',
    baseUrl: '',
    model: '',
    agentId: options.amrAvailable ? 'amr' : 'codex',
    skillId: null,
    designSystemId: null,
    onboardingCompleted: false,
    mediaProviders: {},
    agentModels: options.amrAvailable
      ? { amr: { model: 'default', reasoning: 'default' } }
      : { codex: { model: 'default', reasoning: 'default' } },
  };

  let loggedIn = options.initialLoggedIn;
  let statusCallsAfterLogin = 0;

  await page.route('**/api/health', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { projects: [] } });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { config } });
      return;
    }
    if (route.request().method() === 'PUT') {
      Object.assign(config, route.request().postDataJSON() as Partial<OnboardingConfig>);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      json: {
        agents: [
          ...(options.amrAvailable
            ? [{
                id: 'amr',
                name: 'AMR (vela)',
                bin: 'vela',
                available: true,
                version: '1.0.0',
                models: options.amrModels ?? [{ id: 'default', label: 'Default' }],
              }]
            : []),
          {
            id: 'codex',
            name: 'Codex CLI',
            bin: 'codex',
            available: true,
            version: 'test',
            models: options.codexModels ?? [{ id: 'default', label: 'Default' }],
          },
        ],
      },
    });
  });

  await page.route('**/api/integrations/vela/status', async (route) => {
    if (loggedIn) {
      statusCallsAfterLogin += 1;
      if (options.failFirstStatusPollAfterLogin && statusCallsAfterLogin === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'temporary status failure' }),
        });
        return;
      }
    }
    await route.fulfill({
      json: loggedIn
        ? {
            loggedIn: true,
            profile: 'local',
            configPath: '/tmp/.amr/config.json',
            user: { id: 'user-1', email: 'onboarding@example.com', plan: 'free' },
          }
        : {
            loggedIn: false,
            profile: 'local',
            configPath: '/tmp/.amr/config.json',
            user: null,
          },
    });
  });

  await page.route('**/api/integrations/vela/login', async (route) => {
    loggedIn = true;
    await route.fulfill({
      status: 202,
      json: { pid: 4242, startedAt: new Date().toISOString(), profile: 'local' },
    });
  });

  return config;
}

async function gotoOnboarding(page: Page) {
  await page.goto('/onboarding', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await dismissPrivacyDialog(page);
  await expect(page.getByRole('heading', { name: /Welcome|欢迎/i })).toBeVisible();
}
