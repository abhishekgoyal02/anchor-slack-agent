/**
 * Build the App Home Block Kit view.
 * @returns {import('@slack/types').HomeView}
 */
export function buildAppHomeView() {
  /** @type {import('@slack/types').KnownBlock[]} */
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: "Hey there :wave: I'm your Slack assistant.",
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          "I'm here to help with Gemini-powered responses, commitment tracking, and GitHub issue updates.\n\n" +
          'Send me a *direct message* or *mention me in a channel* to get started.',
      },
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Powered by Google Gemini.',
        },
      ],
    },
  ];

  return { type: 'home', blocks };
}
