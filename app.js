import 'dotenv/config';

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, LogLevel } from '@slack/bolt';

import { registerListeners } from './listeners/index.js';
import { startSyncService } from './services/sync-service.js';

export function createAnchorApp() {
  return new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.DEBUG,
    ignoreSelf: false,
  });
}

/**
 * @param {{
 *   app?: App,
 *   register?: typeof registerListeners,
 *   startSync?: typeof startSyncService,
 * }} [options]
 * @returns {Promise<App>}
 */
export async function startAnchorApp(options = {}) {
  const app = options.app ?? createAnchorApp();
  const register = options.register ?? registerListeners;
  const startSync = options.startSync ?? startSyncService;

  register(app);
  await app.start();
  startSync({
    logger: app.logger,
    client: app.client,
    intervalMs: Number(process.env.LOOP_CLOSURE_INTERVAL_MS || 30000),
  });
  app.logger.info('Anchor is running!');
  return app;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startAnchorApp().catch((error) => {
    console.error('Failed to start Anchor:', error);
    process.exitCode = 1;
  });
}
