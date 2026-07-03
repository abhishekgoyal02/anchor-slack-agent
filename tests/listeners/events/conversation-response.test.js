import assert from 'node:assert';
import { describe, it } from 'node:test';

import { setThinkingStatus } from '../../../listeners/events/conversation-response.js';

describe('conversation response helpers', () => {
  it('continues when Slack assistant status cannot be set', async () => {
    const warningLogs = [];
    const statusError = new Error('not an assistant thread');

    await assert.doesNotReject(
      setThinkingStatus(
        async () => {
          throw statusError;
        },
        {
          warn: (message, context) => {
            warningLogs.push({ message, context });
          },
        },
      ),
    );

    assert.strictEqual(warningLogs.length, 1);
    assert.strictEqual(warningLogs[0].message, 'Failed to set Slack assistant status');
    assert.strictEqual(warningLogs[0].context.message, 'not an assistant thread');
  });

  it('does nothing when no status helper is available', async () => {
    await assert.doesNotReject(setThinkingStatus(undefined));
  });
});
