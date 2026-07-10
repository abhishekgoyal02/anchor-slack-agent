import { handleCommitmentConfirm, handleCommitmentIgnore } from './commitment-buttons.js';
import { handleFeedbackButton } from './feedback-buttons.js';

/**
 * Register action listeners with the Bolt app.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  app.action('feedback', handleFeedbackButton);
  app.action('commitment_confirm', handleCommitmentConfirm);
  app.action('commitment_confirm_recommended', handleCommitmentConfirm);
  app.action('commitment_ignore', handleCommitmentIgnore);
}
