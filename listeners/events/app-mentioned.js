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

    await setThinkingStatus(setStatus);

    const responseText = await generateResponse(cleanedText);

    await streamAssistantResponse(sayStream, responseText);

    // TODO: Store Gemini conversation memory here when Phase 3 introduces it.
    sessionStore.setSession(channelId, threadTs, threadTs);
  } catch (e) {
    logger.error(`Failed to handle app mention: ${e}`);
    await say({
      text: ':warning: Something went wrong while processing your message. Please try again.',
      thread_ts: event.thread_ts || event.ts,
    });
  }
}
