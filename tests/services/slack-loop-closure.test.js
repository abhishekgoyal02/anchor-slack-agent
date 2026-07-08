import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildLoopClosureMessage, postLoopClosureMessage } from '../../services/slack-loop-closure.js';

describe('slack-loop-closure', () => {
  it('builds the exact loop closure message text', () => {
    const message = buildLoopClosureMessage(
      {
        completion_description: 'API migration',
        user_id: 'U123',
        channel_id: 'C123',
        thread_ts: '171.111',
      },
      { number: 21 },
    );

    assert.strictEqual(
      message,
      '✅ Issue #21 has been closed.\n\nThe API migration commitment made by <@U123> is complete.\n\nLoop closed.',
    );
  });

  it('posts the message in the original Slack thread without blocks, buttons, or attachments', async () => {
    let payload;
    const client = {
      chat: {
        postMessage: async (messagePayload) => {
          payload = messagePayload;
        },
      },
    };

    await postLoopClosureMessage(
      client,
      {
        completion_description: 'Login bug',
        user_id: 'U999',
        channel_id: 'C123',
        thread_ts: '171.111',
      },
      { number: 7 },
    );

    assert.deepStrictEqual(payload, {
      channel: 'C123',
      thread_ts: '171.111',
      text: '✅ Issue #7 has been closed.\n\nThe Login bug commitment made by <@U999> is complete.\n\nLoop closed.',
    });
  });
});
