const UNCERTAIN_PREFIX_PATTERN =
  /^(?:maybe|probably|possibly|hopefully|i\s+(?:might|may|think|hope|guess|suppose)|we\s+(?:might|may|think|hope|guess|suppose))\b/i;

const ACTION_VERBS = [
  'set up',
  'take care of',
  'finish',
  'complete',
  'provide',
  'send',
  'share',
  'upload',
  'review',
  'prepare',
  'write',
  'fix',
  'migrate',
  'deploy',
  'push',
  'merge',
  'create',
  'implement',
  'update',
  'deliver',
  'investigate',
  'message',
  'contact',
  'schedule',
  'publish',
  'submit',
  'configure',
  'document',
  'refactor',
  'test',
  'do',
  'draft',
  'patch',
  'ship',
  'handle',
  'take',
  'own',
  'follow up',
  'circle back',
  'book',
  'confirm',
  'check',
  'research',
  'look into',
  'sync',
  'open',
  'close',
  'verify',
  'add',
  'remove',
  'change',
  'clean up',
  'debug',
  'email',
  'call',
];

const ACTION_PATTERN = ACTION_VERBS.map((verb) => verb.replace(/\s+/g, '\\s+')).join('|');

const ALLOW_IMPLICIT_TARGET_ACTIONS = new Set([
  'deploy',
  'push',
  'merge',
  'publish',
  'submit',
  'test',
  'document',
  'ship',
]);

const STARTER_ACTION_PATTERNS = [
  new RegExp(`\\b(?:i|we)(?:'ll| will)\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\b(?:i|we)(?:'ll| will)\\s+try\\s+to\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\b(?:i|we)(?:'m| am|'re| are)\\s+going\\s+to\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\b(?:my|our)\\s+plan\\s+is\\s+to\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\blet me\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bi can\\s+(${ACTION_PATTERN})\\b`, 'i'),
  /\b(?:i|we)\s+(?:can|will)\s+(?:take|own|handle)\b/i,
  new RegExp(`\\bwe\\s+(?:should|need\\s+to|must)\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bneed\\s+to\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bmust\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\blet's\\s+(${ACTION_PATTERN})\\b`, 'i'),
];

const GERUND_ACTION_PATTERN =
  'taking\\s+care\\s+of|working\\s+on|fixing|finishing|completing|providing|sending|sharing|uploading|reviewing|preparing|writing|migrating|deploying|pushing|merging|creating|implementing|updating|delivering|investigating|messaging|contacting|scheduling|publishing|submitting|configuring|documenting|refactoring|testing|drafting|patching|shipping|handling|taking|owning|following\\s+up|booking|confirming|checking|researching|looking\\s+into|syncing|opening|closing|verifying|adding|removing|changing|cleaning\\s+up|debugging|emailing|calling';

const NATURAL_OWNERSHIP_PATTERNS = [
  new RegExp(`\\b(?:i|we)(?:'m| am|'re| are)\\s+(${GERUND_ACTION_PATTERN})\\b`, 'i'),
  /\b(?:i|we)(?:'ll| will)\s+have\b/i,
  /\b(?:i|we)\s+got\s+(?:this|it|the|that|[A-Za-z0-9#@<])/i,
  /\btaking\s+(?:this|the|that|[A-Za-z0-9#@<])/i,
];

const TIMELINE_PATTERN_TEXT = [
  '\\b(?:today|tomorrow|tonight|later)\\b',
  '\\bthis\\s+(?:morning|afternoon|evening|weekend|week)\\b',
  '\\bnext\\s+week\\b',
  '\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b',
  '\\b(?:by|before|on|for)\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|eod|release|deployment)\\b',
  '\\bafter\\s+(?:lunch|work|standup|the\\s+meeting)\\b',
  '\\bby\\s+eod\\b',
  '\\bbefore\\s+(?:release|deployment)\\b',
  '\\bwithin\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:minute|hour|day|week|month)s?\\b',
  '\\bin\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:minute|hour|day|week|month)s?\\b',
].join('|');

const TIMELINE_PATTERN = new RegExp(TIMELINE_PATTERN_TEXT, 'gi');
const TIMELINE_DETECTION_PATTERN = new RegExp(TIMELINE_PATTERN_TEXT, 'i');

const TRAILING_TARGET_PATTERN = /^(?:the|a|an|this|that|these|those|my|your|our|their|it|them|[A-Za-z0-9#@<])/;
const CASUAL_OWNERSHIP_PATTERN =
  /^(?:i(?:'m| am)\s+on\s+it|i\s+got\s+this|taking\s+(?:this|the|that)?\s*(?:task|ticket|issue|one)?|can\s+take\s+(?:this|that|it|this\s+one|the\s+task|the\s+ticket)|on\s+it)$/i;
const NEEDS_DONE_PATTERN = /\bthis\s+needs\s+to\s+be\s+done\b/i;
const LEAVING_FOR_PATTERN =
  /\bleaving\s+.+\s+for\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|this\s+week|next\s+week)\b/i;
const NON_COMMITMENT_PATTERN =
  /^(?:hello|hi|hey|thanks|thank you|nice work|sounds good|approved|looks good|good morning|good afternoon|good evening|ask anchor|context snapshot|loop closure)\b/i;
const QUERY_OR_ASSISTANT_PATTERN =
  /^(?:what|who|where|when|why|how|explain|define|describe|tell me about|search|show|find|list)\b/i;
const COMPLETED_WORK_PATTERN =
  /\b(?:i|we|he|she|they)\s+(?:completed|finished|fixed|deployed|merged|reviewed|updated|shipped|did)\b|\b(?:was|were)\s+(?:completed|finished|fixed|deployed|merged|reviewed|updated|shipped)\b/i;

/**
 * Check that the action has a concrete object after removing schedule-only text.
 * @param {string} text
 * @returns {boolean}
 */
function hasMeaningfulTarget(text) {
  const targetText = text
    .replace(TIMELINE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '');

  return TRAILING_TARGET_PATTERN.test(targetText);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasTimeline(text) {
  return TIMELINE_DETECTION_PATTERN.test(text);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isNonCommitment(text) {
  return (
    !text ||
    text.endsWith('?') ||
    UNCERTAIN_PREFIX_PATTERN.test(text) ||
    NON_COMMITMENT_PATTERN.test(text) ||
    QUERY_OR_ASSISTANT_PATTERN.test(text) ||
    COMPLETED_WORK_PATTERN.test(text)
  );
}

/**
 * @param {string} action
 * @returns {boolean}
 */
function allowsImplicitTarget(action) {
  return ALLOW_IMPLICIT_TARGET_ACTIONS.has(action.toLowerCase().replace(/\s+/g, ' ').trim());
}

/**
 * Detect whether a message likely contains a commitment.
 * @param {string} text
 * @returns {boolean}
 */
export function detectCommitment(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const normalizedText = text
    .replace(/[’]/g, "'")
    .replace(/\bill\b/gi, "I'll")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\blets\b/gi, "let's")
    .replace(/\s+/g, ' ')
    .trim();
  if (isNonCommitment(normalizedText)) {
    return false;
  }

  const intentText = normalizedText.replace(/[.!]+$/g, '');

  if (CASUAL_OWNERSHIP_PATTERN.test(intentText)) {
    return true;
  }

  if (NEEDS_DONE_PATTERN.test(intentText) && hasTimeline(intentText)) {
    return true;
  }

  if (LEAVING_FOR_PATTERN.test(intentText)) {
    return true;
  }

  if (NATURAL_OWNERSHIP_PATTERNS.some((pattern) => hasNaturalOwnershipCommitment(pattern, normalizedText))) {
    return true;
  }

  return STARTER_ACTION_PATTERNS.some((pattern) => {
    const match = pattern.exec(normalizedText);
    if (!match) {
      return false;
    }

    const remainingText = normalizedText.slice(match.index + match[0].length);
    if (hasMeaningfulTarget(remainingText)) {
      return true;
    }

    const action = match[1] ?? '';
    return allowsImplicitTarget(action) && hasTimeline(remainingText);
  });
}

/**
 * @param {RegExp} pattern
 * @param {string} text
 * @returns {boolean}
 */
function hasNaturalOwnershipCommitment(pattern, text) {
  const match = pattern.exec(text);
  if (!match) {
    return false;
  }

  const remainingText = text.slice(match.index + match[0].length);
  return hasMeaningfulTarget(remainingText) || hasTimeline(remainingText);
}
