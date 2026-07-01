import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildAppHomeView } from '../../../listeners/views/app-home-builder.js';

describe('buildAppHomeView', () => {
  it('returns a home view', () => {
    const view = buildAppHomeView();
    assert.strictEqual(view.type, 'home');
  });

  it('has a blocks array with header and section', () => {
    const view = buildAppHomeView();
    assert.ok(Array.isArray(view.blocks));
    assert.ok(view.blocks.length >= 3);
    assert.strictEqual(view.blocks[0].type, 'header');
    assert.strictEqual(view.blocks[1].type, 'section');
  });

  it('shows Gemini provider context', () => {
    const view = buildAppHomeView();
    const mrkdwnTexts = view.blocks.flatMap((b) => {
      if ('text' in b && b.text.type === 'mrkdwn') {
        return b.text.text;
      }
      if ('elements' in b) {
        return b.elements.filter((e) => e.type === 'mrkdwn').map((e) => e.text);
      }
      return [];
    });
    assert.ok(mrkdwnTexts.some((t) => t.includes('Gemini')));
  });
});
