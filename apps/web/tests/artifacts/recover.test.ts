import { describe, expect, it } from 'vitest';

import { recoverHtmlArtifactFromPrecedingDocument } from '../../src/artifacts/recover';

const completeHtml = '<!doctype html><html><head><title>Demo</title></head><body><main><h1>Recovered artifact</h1></main></body></html>';

describe('recoverHtmlArtifactFromPrecedingDocument', () => {
  it('recovers a complete HTML document emitted immediately before a prose artifact tag', () => {
    const sourceText = [
      'Here is the prototype:',
      completeHtml,
      '<artifact identifier="clay-code-longform" type="text/html" title="Clay & Code">',
      '(The complete document above is the delivered artifact.)',
      '</artifact>',
    ].join('\n');

    expect(recoverHtmlArtifactFromPrecedingDocument({
      artifactHtml: '(The complete document above is the delivered artifact.)',
      identifier: 'clay-code-longform',
      sourceText,
    })).toBe(completeHtml);
  });

  it('does not recover when the artifact body is already valid HTML', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({
      artifactHtml: completeHtml,
      identifier: 'demo',
      sourceText: `${completeHtml}\n<artifact identifier="demo">ignored</artifact>`,
    })).toBeNull();
  });

  it('does not recover non-adjacent prior HTML', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({
      artifactHtml: 'summary only',
      identifier: 'demo',
      sourceText: `${completeHtml}\nThis is an explanation.\n<artifact identifier="demo">summary only</artifact>`,
    })).toBeNull();
  });

  it('recovers the immediately preceding html document instead of an earlier doctype document', () => {
    const oldHtml = '<!doctype html><html><head><title>Old</title></head><body><main><h1>Old document</h1></main></body></html>';
    const newHtml = '<html><head><title>New</title></head><body><main><h1>New document</h1></main></body></html>';
    const sourceText = `${oldHtml}\nExplanation between drafts.\n${newHtml}\n<artifact identifier="demo" type="text/html">summary only</artifact>`;

    expect(recoverHtmlArtifactFromPrecedingDocument({
      artifactHtml: 'summary only',
      identifier: 'demo',
      sourceText,
    })).toBe(newHtml);
  });

  it('ignores a stray doctype mention before the immediately preceding html document', () => {
    const html = '<html><head><title>Final</title></head><body><main><h1>Final document</h1></main></body></html>';
    const sourceText = `Mention <!doctype html> in prose.\n${html}\n<artifact identifier="demo" type="text/html">summary only</artifact>`;

    expect(recoverHtmlArtifactFromPrecedingDocument({
      artifactHtml: 'summary only',
      identifier: 'demo',
      sourceText,
    })).toBe(html);
  });
});
