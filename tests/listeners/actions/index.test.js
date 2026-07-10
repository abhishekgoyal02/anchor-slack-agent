import assert from 'node:assert';
import { describe, it } from 'node:test';

import { register } from '../../../listeners/actions/index.js';

describe('action listener registration', () => {
  it('routes recommended commitment actions through the existing confirm handler', () => {
    const actionIds = [];
    const app = {
      action: (actionId, handler) => {
        actionIds.push({ actionId, handler });
      },
    };

    register(app);

    const confirm = actionIds.find((entry) => entry.actionId === 'commitment_confirm');
    const recommended = actionIds.find((entry) => entry.actionId === 'commitment_confirm_recommended');

    assert.ok(confirm);
    assert.ok(recommended);
    assert.strictEqual(recommended.handler, confirm.handler);
  });
});
