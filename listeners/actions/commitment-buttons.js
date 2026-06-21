/**
 * Handle commitment confirmation interactions.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs} args
 * @returns {Promise<void>}
 */
export async function handleCommitmentConfirm({ ack, body, logger, say }) {
  await ack();

  try {
    const threadTs = body.message?.thread_ts || body.message?.ts;
    await say({
      text: 'Commitment confirmed. Task tracking will be added in a later milestone.',
      thread_ts: threadTs,
    });
    logger.debug(`Commitment confirmed for message timestamp: ${body.message?.ts}`);
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
      text: 'Commitment ignored.',
      thread_ts: threadTs,
    });
    logger.debug(`Commitment ignored for message timestamp: ${body.message?.ts}`);
  } catch (e) {
    logger.error(`Failed to handle commitment ignore: ${e}`);
  }
}
