import { buildCommitmentCard } from '../views/commitment-card.js';
import { buildFeedbackBlocks } from '../views/feedback-builder.js';

const LOADING_MESSAGES = [
  'Teaching the hamsters to type faster\u2026',
  'Untangling the internet cables\u2026',
  'Consulting the office goldfish\u2026',
  'Polishing up the response just for you\u2026',
  'Convincing the AI to stop overthinking\u2026',
];

/**
 * Show the existing Slack assistant loading state.
 * @param {Function} setStatus
 * @param {import('../../mcp/logger.js').McpLogger} [logger]
 * @returns {Promise<void>}
 */
export async function setThinkingStatus(setStatus, logger) {
  if (typeof setStatus !== 'function') {
    return;
  }

  try {
    await setStatus({
      status: 'Thinking\u2026',
      loading_messages: LOADING_MESSAGES,
    });
  } catch (error) {
    logger?.warn?.('Failed to set Slack assistant status', serializeError(error));
  }
}

/**
 * Post the existing commitment confirmation card.
 * @param {Function} say
 * @param {string} text
 * @param {string} threadTs
 * @returns {Promise<void>}
 */
export async function postCommitmentCard(say, text, threadTs) {
  await say({
    blocks: buildCommitmentCard(text),
    text: `⚓ Potential commitment detected: "${text}"`,
    thread_ts: threadTs,
  });
}

/**
 * Stream an assistant response with the existing feedback controls.
 * @param {Function} sayStream
 * @param {string} responseText
 * @returns {Promise<void>}
 */
export async function streamAssistantResponse(sayStream, responseText) {
  const streamer = sayStream();
  await streamer.append({ markdown_text: responseText });
  await streamer.stop({ blocks: buildFeedbackBlocks() });
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function serializeError(error) {
  if (!(error instanceof Error)) {
    return { error };
  }

  const context = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if (error.cause !== undefined) {
    context.cause = serializeError(error.cause);
  }

  return context;
}
