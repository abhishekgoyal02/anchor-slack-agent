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

  it('preserves multiline commitment text in the confirmation card payload', async () => {
    const sayCalls = [];
    const text = [
      "I'll migrate authentication to OAuth 2.0 this weekend.",
      '',
      'Need to:',
      '- update JWT validation',
      '- replace refresh tokens',
      '- update documentation',
      '- verify login flow',
      '- write tests',
    ].join('\n');

    await handleMessage({
      event: {
        channel: 'D123',
        channel_type: 'im',
        text,
        ts: '1710000000.000300',
      },
      logger: createLogger(),
      say: async (payload) => {
        sayCalls.push(payload);
      },
      sayStream: failIfCalled('sayStream'),
      setStatus: failIfCalled('setStatus'),
    });

    assert.strictEqual(sayCalls.length, 1);
    assert.strictEqual(sayCalls[0].blocks[0].text.text, `⚓ *Potential commitment detected*\n\n>${text}`);
    assert.strictEqual(sayCalls[0].blocks[1].elements[0].value, text);
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
