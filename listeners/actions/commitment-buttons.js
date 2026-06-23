import { findOpenCommitmentByThreadAndText, saveCommitment } from '../../storage/commitment-store.js';

/**
 * @typedef {{
 *   text: string,
 *   userId: string,
 *   channelId: string,
 *   messageTs: string,
 *   threadTs: string,
 * }} CommitmentActionContext
 */

/**
 * Extract and validate the fields needed to process a commitment action.
 * @param {import('@slack/bolt').SlackAction} body
 * @returns {CommitmentActionContext | null}
 */
function getCommitmentActionContext(body) {
  const actionBody = /** @type {any} */ (body);
  const text = actionBody.actions?.[0]?.value?.trim();
  const userId = actionBody.user?.id;
  const channelId = actionBody.channel?.id;
  const messageTs = actionBody.message?.ts;
  const threadTs = actionBody.message?.thread_ts || messageTs;

  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    typeof userId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof messageTs !== 'string' ||
    typeof threadTs !== 'string'
  ) {
    return null;
  }

  return { text, userId, channelId, messageTs, threadTs };
}

/**
 * Post a friendly ephemeral message when enough Slack context is available.
 * @param {import('@slack/web-api').WebClient} client
 * @param {{ channelId?: string, userId?: string, threadTs?: string }} context
 * @param {string} text
 * @returns {Promise<void>}
 */
async function postFriendlyEphemeral(client, { channelId, userId, threadTs }, text) {
  if (!channelId || !userId) {
    return;
  }

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text,
  });
}

/**
 * Build final-state blocks for commitment interactions.
 * @param {string} title
 * @param {string} text
 * @param {string} detail
 * @returns {import('@slack/types').KnownBlock[]}
 */
function buildCommitmentResultBlocks(title, text, detail) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${title}\n\n>${text}\n\n${detail}`,
      },
    },
  ];
}

/**
 * Handle commitment confirmation interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentConfirm({ ack, body, client, logger }) {
  await ack();

  const actionContext = getCommitmentActionContext(body);
  const bodyForFallback = /** @type {any} */ (body);
  if (!actionContext) {
    logger.warn('Invalid commitment confirmation payload received');
    await postFriendlyEphemeral(
      client,
      {
        channelId: bodyForFallback.channel?.id,
        userId: bodyForFallback.user?.id,
        threadTs: bodyForFallback.message?.thread_ts || bodyForFallback.message?.ts,
      },
      '⚠️ Unable to process this commitment. Please try again.',
    );
    return;
  }

  const { channelId, messageTs, text, threadTs, userId } = actionContext;

  try {
    const existing = await findOpenCommitmentByThreadAndText(threadTs, text);
    if (existing) {
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: '⚠️ Commitment Already Tracked',
        blocks: buildCommitmentResultBlocks(
          '⚠️ *Commitment Already Tracked*',
          text,
          'This commitment is already being tracked and does not need to be confirmed again.',
        ),
      });
      return;
    }

    await saveCommitment({ text, userId, channelId, threadTs });

    const updatePayload = {
      channel: channelId,
      ts: messageTs,
      text: '⚓ Commitment Confirmed',
      blocks: buildCommitmentResultBlocks('⚓ *Commitment Confirmed*', text, '*Status:* Tracked'),
    };

    logger.debug(`chat.update payload (Confirm): ${JSON.stringify(updatePayload)}`);
    await client.chat.update(updatePayload);
    logger.debug(`Commitment saved for user ${userId} in channel ${channelId}`);
  } catch (e) {
    logger.error(`Failed to handle commitment confirm: ${e}`);
    await postFriendlyEphemeral(
      client,
      actionContext,
      '⚠️ Unable to save this commitment right now. Please try again.',
    ).catch((postError) => {
      logger.error(`Failed to post commitment error message: ${postError}`);
    });
  }
}

/**
 * Handle commitment ignore interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentIgnore({ ack, body, client, logger }) {
  await ack();

  const actionContext = getCommitmentActionContext(body);
  const bodyForFallback = /** @type {any} */ (body);
  if (!actionContext) {
    logger.warn('Invalid commitment ignore payload received');
    await postFriendlyEphemeral(
      client,
      {
        channelId: bodyForFallback.channel?.id,
        userId: bodyForFallback.user?.id,
        threadTs: bodyForFallback.message?.thread_ts || bodyForFallback.message?.ts,
      },
      '⚠️ Unable to process this commitment. Please try again.',
    );
    return;
  }

  const { channelId, messageTs, text } = actionContext;

  try {
    const updatePayload = {
      channel: channelId,
      ts: messageTs,
      text: '⚓ Commitment Ignored',
      blocks: buildCommitmentResultBlocks('⚓ *Commitment Ignored*', text, 'No tracking record was created.'),
    };

    logger.debug(`chat.update payload (Ignore): ${JSON.stringify(updatePayload)}`);
    await client.chat.update(updatePayload);
    logger.debug(`Commitment ignored for message timestamp: ${messageTs}`);
  } catch (e) {
    logger.error(`Failed to handle commitment ignore: ${e}`);
    await postFriendlyEphemeral(
      client,
      actionContext,
      '⚠️ Unable to update this commitment right now. Please try again.',
    ).catch((postError) => {
      logger.error(`Failed to post commitment ignore error message: ${postError}`);
    });
  }
}
