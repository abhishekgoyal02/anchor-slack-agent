import { findOpenCommitmentByThreadAndText, saveCommitment } from '../../storage/commitment-store.js';

/**
 * Handle commitment confirmation interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentConfirm({ ack, body, client, logger, say }) {
  await ack();

  try {
    const text = body.actions?.[0]?.value || '';
    const userId = body.user?.id;
    const channelId = body.channel?.id;
    const threadTs = body.message?.thread_ts || body.message?.ts;

    const existing = await findOpenCommitmentByThreadAndText(threadTs, text);
    if (existing) {
      await say({
        text: '⚓ This commitment is already being tracked.',
        thread_ts: threadTs,
      });
      return;
    }

    await saveCommitment({ text, userId, channelId, threadTs });

    const updatePayload = {
      channel: body.channel?.id,
      ts: body.message?.ts,
      text: '⚓ Commitment Confirmed',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚓ *Commitment Confirmed*\n\n>${text}\n\n*Status:* Tracked`,
          },
        },
      ],
    };

    logger.debug(`chat.update payload (Confirm): ${JSON.stringify(updatePayload)}`);
    await client.chat.update(updatePayload);
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
export async function handleCommitmentIgnore({ ack, body, client, logger }) {
  await ack();

  try {
    const text = body.actions?.[0]?.value || '';

    const updatePayload = {
      channel: body.channel?.id,
      ts: body.message?.ts,
      text: '⚓ Commitment Ignored',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚓ *Commitment Ignored*\n\n>${text}`,
          },
        },
      ],
    };

    logger.debug(`chat.update payload (Ignore): ${JSON.stringify(updatePayload)}`);
    await client.chat.update(updatePayload);
    logger.debug(`Commitment ignored for message timestamp: ${body.message?.ts}`);
  } catch (e) {
    logger.error(`Failed to handle commitment ignore: ${e}`);
  }
}
