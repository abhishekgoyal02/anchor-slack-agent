/**
 * @typedef {{
 *   completion_description: string,
 *   user_id?: string | null,
 *   channel_id: string,
 *   thread_ts: string,
 * }} LoopClosureCommitment
 */

/**
 * Build the exact Slack thread reply used when a GitHub-backed commitment closes.
 * @param {LoopClosureCommitment} commitment
 * @param {{ number: number }} issue
 * @returns {string}
 */
export function buildLoopClosureMessage(commitment, issue) {
  const description = commitment.completion_description || 'this';
  const user = formatSlackUser(commitment.user_id);

  return [
    `✅ Issue #${issue.number} has been closed.`,
    '',
    `The ${description} commitment made by ${user} is complete.`,
    '',
    'Loop closed.',
  ].join('\n');
}

/**
 * Post the Loop Closure completion message in the original Slack thread.
 * @param {import('@slack/web-api').WebClient} client
 * @param {LoopClosureCommitment} commitment
 * @param {{ number: number }} issue
 * @returns {Promise<void>}
 */
export async function postLoopClosureMessage(client, commitment, issue) {
  await client.chat.postMessage({
    channel: commitment.channel_id,
    thread_ts: commitment.thread_ts,
    text: buildLoopClosureMessage(commitment, issue),
  });
}

/**
 * @param {string | null | undefined} userId
 * @returns {string}
 */
function formatSlackUser(userId) {
  const normalized = userId?.trim();
  if (!normalized) {
    return 'the original Slack user';
  }

  if (normalized.startsWith('<@') && normalized.endsWith('>')) {
    return normalized;
  }

  return `<@${normalized}>`;
}
