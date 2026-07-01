import { buildAppHomeView } from '../views/app-home-builder.js';

/**
 * Publish the App Home view when a user opens the app's Home tab.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'app_home_opened'>} args
 * @returns {Promise<void>}
 */
export async function handleAppHomeOpened({ client, context, logger }) {
  try {
    const userId = /** @type {string} */ (context.userId);

    const view = buildAppHomeView();
    await client.views.publish({ user_id: userId, view });
  } catch (e) {
    logger.error(`Failed to publish App Home: ${e}`);
  }
}
