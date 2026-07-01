import assert from 'node:assert';
import { describe, it } from 'node:test';

import { handleAppMentioned } from '../../../listeners/events/app-mentioned.js';
import { handleMessage } from '../../../listeners/events/message.js';

describe('message listeners', () => {
  it('posts a commitment card and stops before Gemini for direct messages', async () => {
    const sayCalls = [];

    await handleMessage({
      event: {
        channel: 'D123',
        channel_type: 'im',
        text: "I'll do API documentation by Wednesday.",
        ts: '1710000000.000100',
      },
      logger: createLogger(),
      say: async (payload) => {
        sayCalls.push(payload);
      },
      sayStream: failIfCalled('sayStream'),
      setStatus: failIfCalled('setStatus'),
    });

    assert.strictEqual(sayCalls.length, 1);
    assert.match(sayCalls[0].text, /Potential commitment detected/);
    assert.strictEqual(sayCalls[0].thread_ts, '1710000000.000100');
  });

  it('posts a commitment card and stops before Gemini for app mentions', async () => {
    const sayCalls = [];

    await handleAppMentioned({
      event: {
        channel: 'C123',
        text: "<@U999> I'll do API documentation by Wednesday.",
        ts: '1710000000.000200',
      },
      logger: createLogger(),
      say: async (payload) => {
        sayCalls.push(payload);
      },
      sayStream: failIfCalled('sayStream'),
      setStatus: failIfCalled('setStatus'),
    });

    assert.strictEqual(sayCalls.length, 1);
    assert.match(sayCalls[0].text, /Potential commitment detected/);
    assert.strictEqual(sayCalls[0].thread_ts, '1710000000.000200');
  });
});

function createLogger() {
  return {
    debug: () => {},
    error: () => {},
    warn: () => {},
  };
}

/**
 * @param {string} name
 * @returns {() => never}
 */
function failIfCalled(name) {
  return () => {
    throw new Error(`${name} should not be called for commitment messages`);
  };
}
