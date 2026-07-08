import assert from 'node:assert';
import { describe, it } from 'node:test';

import { startAnchorApp } from '../app.js';

describe('app startup', () => {
  it('starts synchronization polling on app startup', async () => {
    const previousInterval = process.env.LOOP_CLOSURE_INTERVAL_MS;
    process.env.LOOP_CLOSURE_INTERVAL_MS = '45678';

    const registered = [];
    const started = [];
    const syncStarts = [];
    const app = {
      client: { chat: { postMessage: async () => {} } },
      logger: { info: () => {} },
      start: async () => {
        started.push(true);
      },
    };

    const result = await startAnchorApp({
      app,
      register: (registeredApp) => {
        registered.push(registeredApp);
      },
      startSync: (options) => {
        syncStarts.push(options);
      },
    });

    assert.strictEqual(result, app);
    assert.deepStrictEqual(registered, [app]);
    assert.deepStrictEqual(started, [true]);
    assert.strictEqual(syncStarts.length, 1);
    assert.strictEqual(syncStarts[0].client, app.client);
    assert.strictEqual(syncStarts[0].logger, app.logger);
    assert.strictEqual(syncStarts[0].intervalMs, 45678);

    if (previousInterval === undefined) {
      delete process.env.LOOP_CLOSURE_INTERVAL_MS;
    } else {
      process.env.LOOP_CLOSURE_INTERVAL_MS = previousInterval;
    }
  });
});
