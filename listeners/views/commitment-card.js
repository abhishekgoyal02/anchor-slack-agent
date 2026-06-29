/**
 * Build a commitment confirmation card.
 * @param {string} messageText
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentCard(messageText) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚓ *Potential commitment detected*\n\n>${messageText}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Confirm',
          },
          style: 'primary',
          action_id: 'commitment_confirm',
          value: messageText,
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Ignore',
          },
          action_id: 'commitment_ignore',
          value: messageText,
        },
      ],
    },
  ];
}

/**
 * Build a final commitment confirmation card.
 * @param {string} messageText
 * @param {{ issueNumber?: number, issueUrl?: string, githubError?: boolean }} [options]
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentConfirmedCard(messageText, options = {}) {
  const details = ['*Status:* Tracked'];

  if (options.issueNumber && options.issueUrl) {
    details.push(`*GitHub Issue:* <${options.issueUrl}|#${options.issueNumber}>`);
  } else if (options.githubError) {
    details.push('GitHub issue could not be created.');
    details.push('Commitment remains stored locally.');
  }

  return buildCommitmentResultCard('⚓ *Commitment Confirmed*', messageText, details.join('\n'));
}

/**
 * Build a duplicate commitment card.
 * @param {string} messageText
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentAlreadyTrackedCard(messageText) {
  return buildCommitmentResultCard(
    '⚠️ *Commitment Already Tracked*',
    messageText,
    'This commitment is already being tracked and does not need to be confirmed again.',
  );
}

/**
 * Build an ignored commitment card.
 * @param {string} messageText
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentIgnoredCard(messageText) {
  return buildCommitmentResultCard('⚓ *Commitment Ignored*', messageText, 'No tracking record was created.');
}

/**
 * Build final-state blocks for commitment interactions.
 * @param {string} title
 * @param {string} messageText
 * @param {string} detail
 * @returns {import('@slack/types').KnownBlock[]}
 */

/**
 * Build a completed commitment card.
 * @param {string} messageText
 * @param {{ issueNumber?: number, issueUrl?: string }} [options]
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildCommitmentCompletedCard(messageText, options = {}) {
  const details = [
    '*Status:* Completed ✅',
    '',
    'Anchor detected that this commitment has been completed.',
  ];

  if (options.issueNumber && options.issueUrl) {
    details.push('');
    details.push(`*GitHub Issue:* <${options.issueUrl}|#${options.issueNumber}> (Closed)`);
  }

  return buildCommitmentResultCard(
    '✅ *Commitment Completed*',
    messageText,
    details.join('\n'),
  );
}
function buildCommitmentResultCard(title, messageText, detail) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${title}\n\n>${messageText}\n\n${detail}`,
      },
    },
  ];
}
