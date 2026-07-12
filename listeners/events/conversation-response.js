import { analyzeRealityCheck, createFallbackRealityCheck } from '../../services/reality-check-service.js';
import { buildCommitmentCard } from '../views/commitment-card.js';
import { buildFeedbackBlocks } from '../views/feedback-builder.js';

const LOADING_MESSAGES = [
  'Teaching the hamsters to type faster\u2026',
  'Untangling the internet cables\u2026',
  'Consulting the office goldfish\u2026',
  'Polishing up the response just for you\u2026',
  'Convincing the AI to stop overthinking\u2026',
];

const OFF_DOMAIN_RESPONSES = [
  "🐧 I'm built for project chaos, not trivia. Try asking about commitments, GitHub issues, blockers, or who's working on something.",
  "🐟 Oops... that's outside my swim lane. Ask me about your team's commitments or project progress instead.",
  "🦈 That's a little beyond my ocean. I keep track of work, not general knowledge. Try a GitHub or commitment question.",
  "🦢 Not my pond today. I'm here for commitments, releases, blockers, and ownership—not encyclopedia mode.",
  "🐠 Nice try. I only keep tabs on your team's work. Ask me about commits, issues, deadlines, or commitments.",
  "🐬 That's one for a general AI assistant. I'm focused on helping your team stay accountable.",
];

const WORK_ROUTING_PATTERN =
  /\b(?:commitments?|github|issues?|projects?|pull requests?|prs?|repositories|repos?|releases?|blockers?|ownership|owners?|owns?|owned|working on|deadlines?|due dates?|overdue|slack|context snapshot|reality check|loop closure|mcp|gemini|authentication|oauth|deployment|deploy|documentation|docs?|api commitment|frontend|backend|open commitments?|completed commitments?|show|search|find|list)\b/i;

const GENERAL_KNOWLEDGE_PATTERNS = [
  /^(?:what|who|where|when|why)\s+(?:is|are|was|were|won|invented|created|made)\b/i,
  /^(?:what's|whats)\s+(?:the\s+)?(?:capital|meaning|definition)\b/i,
  /^(?:explain|define|describe)\b/i,
  /^tell\s+me\s+about\b/i,
  /^how\s+(?:to|do|does|did|can)\b/i,
  /^write\s+[\w\s-]*\bcode\b/i,
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
 * @param {import('../../mcp/logger.js').McpLogger} [logger]
 * @returns {Promise<void>}
 */
export async function postCommitmentCard(say, text, threadTs, logger) {
  const blocks = await buildCommitmentBlocksSafely(text, logger);

  try {
    await say({
      blocks,
      text: `🧠 Reality Check found a commitment. "${text}"`,
      thread_ts: threadTs,
    });
  } catch (error) {
    logger?.error?.('Failed to post commitment card', serializeError(error));
    throw error;
  }
}

/**
 * @param {string} text
 * @param {import('../../mcp/logger.js').McpLogger} [logger]
 * @returns {Promise<import('@slack/types').KnownBlock[]>}
 */
async function buildCommitmentBlocksSafely(text, logger) {
  try {
    const realityCheck = await analyzeRealityCheck(text);
    return buildCommitmentCard(text, realityCheck);
  } catch (error) {
    logger?.error?.('Reality Check card generation failed; using fallback commitment card', serializeError(error));
    return buildCommitmentCard(text, createFallbackRealityCheck(text));
  }
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
 * Detect encyclopedia-style prompts that should not reach Gemini unless they
 * clearly route to Anchor's commitment/work domain.
 * @param {string} text
 * @returns {boolean}
 */
export function isOffDomainGeneralKnowledgePrompt(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText || WORK_ROUTING_PATTERN.test(normalizedText)) {
    return false;
  }

  return GENERAL_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(normalizedText));
}

/**
 * @returns {string}
 */
export function getRandomOffDomainResponse() {
  const index = Math.floor(Math.random() * OFF_DOMAIN_RESPONSES.length);
  return OFF_DOMAIN_RESPONSES[index];
}

/**
 * @param {Function} say
 * @param {string} threadTs
 * @returns {Promise<void>}
 */
export async function postOffDomainResponse(say, threadTs) {
  await say({
    text: getRandomOffDomainResponse(),
    thread_ts: threadTs,
  });
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
