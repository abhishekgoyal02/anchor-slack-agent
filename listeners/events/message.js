import { detectCommitment } from '../../services/commitment-detector.js';
import { generateResponse } from '../../services/gemini-service.js';
import { sessionStore } from '../../thread-context/index.js';
import { postCommitmentCard, setThinkingStatus, streamAssistantResponse } from './conversation-response.js';

/**
 * @param {import('@slack/types').MessageEvent} event
 * @returns {event is import('@slack/types').GenericMessageEvent}
 */
function isGenericMessageEvent(event) {
  return !('subtype' in event && event.subtype !== undefined);
}

/**
 * @param {import('@slack/types').MessageEvent} event
 * @returns {boolean}
 */
function shouldHandleMessage(event) {
  if (!isGenericMessageEvent(event) || event.bot_id) {
    return false;
  }

  if (event.channel_type === 'im') {
    return true;
  }

  if (!event.thread_ts) {
    return false;
  }

  return sessionStore.getSession(event.channel, event.thread_ts) !== null;
}

/**
 * Handle messages sent via DM or in threads the bot is part of.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'message'>} args
 * @returns {Promise<void>}
 */
export async function handleMessage({ event, logger, say, sayStream, setStatus }) {
  if (!shouldHandleMessage(event)) {
    return;
  }

  try {
    const channelId = event.channel;
    const text = event.text || '';
    const threadTs = event.thread_ts || event.ts;

    if (detectCommitment(text)) {
      await postCommitmentCard(say, text, threadTs);
      return;
    }

    await setThinkingStatus(setStatus);

    const responseText = await generateResponse(text);

    await streamAssistantResponse(sayStream, responseText);

    // TODO: Store Gemini conversation memory here when Phase 3 introduces it.
    sessionStore.setSession(channelId, threadTs, threadTs);
  } catch (e) {
    logger.error(`Failed to handle message: ${e}`);
    await say({
      text: ':warning: Something went wrong while processing your message. Please try again.',
      thread_ts: event.thread_ts || event.ts,
    }).catch((sayError) => {
      logger.error(`Failed to send error fallback message: ${sayError}`);
    });
  }
}
