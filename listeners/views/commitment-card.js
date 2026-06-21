/**
 * Build a commitment confirmation card.
 * @param {string} messageText
 * @returns {Array}
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
