import { saveCommitment } from '../../storage/commitment-store.js';

/**
 * Handle commitment confirmation interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentConfirm({ ack, body, logger, say }) {
  await ack();

  try {
    const text = body.actions?.[0]?.value || '';
    const userId = body.user?.id;
    const channelId = body.channel?.id;
    const threadTs = body.message?.thread_ts || body.message?.ts;

    await saveCommitment({ text, userId, channelId, threadTs });

    await say({
      text: '⚓ Commitment confirmed and saved.',
      thread_ts: threadTs,
    });
    logger.debug(`Commitment saved for user ${userId} in channel ${channelId}`);
  } catch (e) {
    logger.error(`Failed to handle commitment confirm: ${e}`);
  }
}

/**
 * Handle commitment ignore interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentIgnore({ ack, body, logger, say }) {
  await ack();

  try {
    const threadTs = body.message?.thread_ts || body.message?.ts;
    await say({
      text: '⚓ Commitment ignored.',
      thread_ts: threadTs,
    });
    logger.debug(`Commitment ignored for message timestamp: ${body.message?.ts}`);
  } catch (e) {
    logger.error(`Failed to handle commitment ignore: ${e}`);
  }
}
