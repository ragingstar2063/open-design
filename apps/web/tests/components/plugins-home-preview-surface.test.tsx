// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewSurface } from '../../src/components/plugins-home/cards/PreviewSurface';
import type { MediaPreviewSpec } from '../../src/components/plugins-home/preview';

const visibilityQueue: boolean[] = [];

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({
    ref: { current: null },
    inView: visibilityQueue.shift() ?? false,
  }),
}));

vi.mock('../../src/components/plugins-home/cards/MediaSurface', () => ({
  MediaSurface: ({ inView, visible }: { inView: boolean; visible?: boolean }) => (
    <div data-testid="media-surface" data-in-view={String(inView)} data-visible={String(visible)} />
  ),
}));

vi.mock('../../src/components/plugins-home/cards/HtmlSurface', () => ({
  HtmlSurface: () => <div data-testid="html-surface" />,
}));

vi.mock('../../src/components/plugins-home/cards/DesignSystemSurface', () => ({
  DesignSystemSurface: () => <div data-testid="design-surface" />,
}));

vi.mock('../../src/components/plugins-home/cards/TextSurface', () => ({
  TextSurface: () => <div data-testid="text-surface" />,
}));

const IMAGE_PREVIEW: MediaPreviewSpec = {
  kind: 'media',
  mediaType: 'image',
  poster: 'https://example.invalid/poster.jpg',
  videoUrl: null,
  audioUrl: null,
  imageOnly: true,
};

const PLAIN_VIDEO_PREVIEW: MediaPreviewSpec = {
  ...IMAGE_PREVIEW,
  mediaType: 'video',
  videoUrl: 'https://example.invalid/plain.mp4',
  imageOnly: false,
};

const BAKED_CLIP_PREVIEW: MediaPreviewSpec = {
  ...PLAIN_VIDEO_PREVIEW,
  videoUrl: 'https://example.invalid/baked.mp4',
  loopHoldMs: 2500,
};

function renderWithVisibility(preview: MediaPreviewSpec) {
  // PreviewSurface calls useInView in this order: near, keep, visible. Make the
  // values intentionally disagree so the gate passed to MediaSurface proves
  // which zone each media subtype uses.
  visibilityQueue.splice(0, visibilityQueue.length, true, false, true);
  render(
    <PreviewSurface pluginId="sample" pluginTitle="Sample" preview={preview} />,
  );
  return screen.getByTestId('media-surface');
}

afterEach(() => {
  cleanup();
  visibilityQueue.splice(0, visibilityQueue.length);
});

describe('PreviewSurface media visibility gates', () => {
  beforeEach(() => {
    visibilityQueue.splice(0, visibilityQueue.length);
  });

  it('keeps image media on the tight near margin', () => {
    expect(renderWithVisibility(IMAGE_PREVIEW).dataset.inView).toBe('true');
  });

  it('keeps plain video media on the tight near margin', () => {
    expect(renderWithVisibility(PLAIN_VIDEO_PREVIEW).dataset.inView).toBe('true');
  });

  it('uses the wide keepalive margin only for baked hover-pan clips', () => {
    expect(renderWithVisibility(BAKED_CLIP_PREVIEW).dataset.inView).toBe('false');
  });
});
