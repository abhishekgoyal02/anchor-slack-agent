import { createIssue } from '../../services/github-service.js';
import {
  findOpenCommitmentByThreadAndText,
  saveCommitment,
  updateCommitmentGithubMetadata,
} from '../../storage/commitment-store.js';
import {
  buildCommitmentAlreadyTrackedCard,
  buildCommitmentConfirmedCard,
  buildCommitmentIgnoredCard,
} from '../views/commitment-card.js';

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
 * Validate commitment action payload or send fallback ephemeral message.
 * @param {import('@slack/bolt').SlackAction} body
 * @param {import('@slack/web-api').WebClient} client
 * @param {any} logger
 * @param {string} actionName
 * @returns {Promise<CommitmentActionContext | null>}
 */
async function validateActionContext(body, client, logger, actionName) {
  const actionContext = getCommitmentActionContext(body);
  if (actionContext) {
    return actionContext;
  }

  logger.warn(`Invalid commitment ${actionName} payload received`);
  const bodyForFallback = /** @type {any} */ (body);
  await postFriendlyEphemeral(
    client,
    {
      channelId: bodyForFallback.channel?.id,
      userId: bodyForFallback.user?.id,
      threadTs: bodyForFallback.message?.thread_ts || bodyForFallback.message?.ts,
    },
    '⚠️ Unable to process this commitment. Please try again.',
  );
  return null;
}

/**
 * Handle commitment confirmation interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentConfirm({ ack, body, client, logger }) {
  await ack();

  const actionContext = await validateActionContext(body, client, logger, 'confirmation');
  if (!actionContext) return;

  const { channelId, messageTs, text, threadTs, userId } = actionContext;

  try {
    const existing = await findOpenCommitmentByThreadAndText(threadTs, text);
    if (existing) {
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: '⚠️ Commitment Already Tracked',
        blocks: buildCommitmentAlreadyTrackedCard(text),
      });
      return;
    }

    const commitmentId = await saveCommitment({
      text,
      userId,
      channelId,
      threadTs,
      messageTs,
    });
    let issue;
    let githubError = false;

    try {
      issue = await createIssue({ text, userId, threadTs }, { logger });
      const updated = await updateCommitmentGithubMetadata(commitmentId, {
        issueNumber: issue.number,
        issueUrl: issue.url,
      });

      if (!updated) {
        githubError = true;
        logger.error(`Failed to update GitHub metadata for commitment ${commitmentId}: no row updated`);
      }
    } catch (githubIssueError) {
      githubError = true;
      logger.error(`Failed to create or link GitHub issue for commitment ${commitmentId}: ${githubIssueError}`);
    }

    const updatePayload = {
      channel: channelId,
      ts: messageTs,
      text: '⚓ Commitment Confirmed',
      blocks:
        issue && !githubError
          ? buildCommitmentConfirmedCard(text, { issueNumber: issue.number, issueUrl: issue.url })
          : buildCommitmentConfirmedCard(text, { githubError: true }),
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

  const actionContext = await validateActionContext(body, client, logger, 'ignore');
  if (!actionContext) return;

  const { channelId, messageTs, text } = actionContext;

  try {
    const updatePayload = {
      channel: channelId,
      ts: messageTs,
      text: '⚓ Commitment Ignored',
      blocks: buildCommitmentIgnoredCard(text),
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
