import 'dotenv/config';

import { App, LogLevel } from '@slack/bolt';

import { registerListeners } from './listeners/index.js';
import { startSyncService } from './services/sync-service.js';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
  ignoreSelf: false,
});

registerListeners(app);

(async () => {
  await app.start();
  startSyncService({
    logger: app.logger,
    client: app.client,
    intervalMs: Number(process.env.SYNC_INTERVAL_MS || 300000),
  });
  app.logger.info('Starter Agent is running!');
})();
