import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchLatestGithubReleaseInfo } from '../../src/providers/registry';

const originalFetch = globalThis.fetch;

describe('fetchLatestGithubReleaseInfo', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reads the latest release metadata from the daemon endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v0.8.0-nightly.3',
        html_url: 'https://github.com/nexu-io/open-design/releases/tag/v0.8.0-nightly.3',
        stale: false,
      }),
    } satisfies Partial<Response>) as typeof fetch;

    const result = await fetchLatestGithubReleaseInfo();

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/github/open-design/releases/latest');
    expect(result).toEqual({
      tagName: 'v0.8.0-nightly.3',
      htmlUrl: 'https://github.com/nexu-io/open-design/releases/tag/v0.8.0-nightly.3',
      stale: false,
    });
  });

  it('returns null when the daemon endpoint fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } satisfies Partial<Response>) as typeof fetch;

    await expect(fetchLatestGithubReleaseInfo()).resolves.toBeNull();
  });
});
