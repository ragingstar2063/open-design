// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

describe('GithubStarBadge', () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses the daemon-backed GitHub endpoint and keeps a fallback label on failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    const { GithubStarBadge } = await import('../../src/components/GithubStarBadge');

    render(<GithubStarBadge />);

    expect(screen.getByText('Star')).toBeTruthy();
    expect(screen.getByText('40K+')).toBeTruthy();
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/github/open-design',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('renders the live star count returned by the daemon endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 42137 }),
    } satisfies Partial<Response>) as typeof fetch;
    const { GithubStarBadge } = await import('../../src/components/GithubStarBadge');

    render(<GithubStarBadge />);

    await waitFor(() => expect(screen.getByText('42.1K')).toBeTruthy());
  });
});
