import { describe, expect, it } from 'vitest';

import {
  buildInlineMentionParts,
  mentionContextPresent,
  type InlineMentionEntity,
} from '../../src/utils/inlineMentions';

describe('buildInlineMentionParts', () => {
  it('skips entity matching when plain text has no mention marker', () => {
    const entities: InlineMentionEntity[] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `file-${index}`,
      kind: 'file',
      label: `file-${index}.html`,
      token: `@file-${index}.html`,
    }));

    expect(buildInlineMentionParts('typing ordinary Chinese text without mentions', entities)).toBeNull();
  });

  it('does not normalize entities on plain text drafts', () => {
    const entity = {
      id: 'index.html',
      kind: 'file',
      label: 'index.html',
      get token() {
        throw new Error('token should not be read for plain text');
      },
    } as InlineMentionEntity;

    expect(buildInlineMentionParts('plain text only', [entity])).toBeNull();
  });

  it('still highlights known mentions when the draft contains a marker', () => {
    const parts = buildInlineMentionParts('Review @index.html', [
      { id: 'index.html', kind: 'file', label: 'index.html' },
    ]);

    expect(parts).toEqual([
      { kind: 'text', text: 'Review ' },
      {
        kind: 'mention',
        text: '@index.html',
        entity: {
          id: 'index.html',
          kind: 'file',
          label: 'index.html',
          token: '@index.html',
        },
      },
    ]);
  });
});

describe('mentionContextPresent', () => {
  it('counts a mention immediately followed by CJK prose as present', () => {
    // The renderer draws `@Notion你好` as the `@Notion` chip plus plain text,
    // so submit-time filtering must agree and keep the context (#3555).
    expect(mentionContextPresent('@Notion你好', ['Notion'])).toBe(true);
    // The renderer still draws the chip when followed by CJK, so present.
    const parts = buildInlineMentionParts('@Notion你好', [
      { id: 'notion', kind: 'connector', label: 'Notion' },
    ]);
    expect(parts?.[0]).toMatchObject({ kind: 'mention', text: '@Notion' });
  });

  it('matches any registered alias, including an id distinct from the label', () => {
    // Connectors / MCP register both `@name`/`@label` AND `@id`, so a prompt
    // that mentions the id alias must still resolve the context (#3555).
    expect(mentionContextPresent('@my-server please', ['My Server', 'my-server'])).toBe(true);
    // The label alias on its own would not match the id-only prompt.
    expect(mentionContextPresent('@my-server please', ['My Server'])).toBe(false);
  });

  it('requires a left boundary like the renderer', () => {
    expect(mentionContextPresent('email user@Notion.com', ['Notion'])).toBe(false);
    expect(mentionContextPresent('ping @Notion', ['Notion'])).toBe(true);
  });

  it('ignores empty or missing candidate names', () => {
    expect(mentionContextPresent('@Notion', [null, undefined, ''])).toBe(false);
  });
});
