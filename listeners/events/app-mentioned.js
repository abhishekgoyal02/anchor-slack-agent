import { detectCommitment } from '../../services/commitment-detector.js';
import { generateResponse } from '../../services/gemini-service.js';
import { sessionStore } from '../../thread-context/index.js';
import { postCommitmentCard, setThinkingStatus, streamAssistantResponse } from './conversation-response.js';

/**
 * Handle app_mention events and generate a Gemini response.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'app_mention'>} args
 * @returns {Promise<void>}
 */
export async function handleAppMentioned({ event, logger, say, sayStream, setStatus }) {
  try {
    const channelId = event.channel;
    const text = event.text || '';
    const threadTs = event.thread_ts || event.ts;
    const cleanedText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!cleanedText) {
      await say({
        text: "Hey there! How can I help you? Ask me anything and I'll do my best.",
        thread_ts: threadTs,
      });
      return;
    }

    if (detectCommitment(cleanedText)) {
      await postCommitmentCard(say, cleanedText, threadTs);
      return;
    }

    await setThinkingStatus(setStatus, logger);

    const responseText = await generateResponse(cleanedText);

    await streamAssistantResponse(sayStream, responseText);

    sessionStore.setSession(channelId, threadTs, threadTs);
  } catch (e) {
    logListenerError(logger, 'Failed to handle app mention', e);
    await say({
      text: ':warning: Something went wrong while processing your message. Please try again.',
      thread_ts: event.thread_ts || event.ts,
    });
  }
}

/**
 * @param {import('../../mcp/logger.js').McpLogger} logger
 * @param {string} message
 * @param {unknown} error
 * @returns {void}
 */
function logListenerError(logger, message, error) {
  logger.error(message, serializeError(error));
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
