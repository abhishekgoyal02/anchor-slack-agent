const UNCERTAIN_PREFIX_PATTERN =
  /^(?:maybe|probably|possibly|hopefully|i\s+(?:might|may|think|hope|guess|suppose)|we\s+(?:might|may|think|hope|guess|suppose))\b/i;

const ACTION_VERBS = [
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

const ALLOW_IMPLICIT_TARGET_ACTIONS = new Set(['deploy', 'push', 'merge', 'publish', 'submit', 'test', 'document']);

const STARTER_ACTION_PATTERNS = [
  new RegExp(`\\b(?:i|we)(?:'ll| will)\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\blet me\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bi can\\s+(${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\blet's\\s+(${ACTION_PATTERN})\\b`, 'i'),
];

const TIMELINE_PATTERN_TEXT = [
  '\\b(?:today|tomorrow|tonight|later)\\b',
  '\\bthis\\s+(?:morning|afternoon|evening|weekend|week)\\b',
  '\\bnext\\s+week\\b',
  '\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b',
  '\\b(?:by|before|on)\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight)\\b',
  '\\bafter\\s+(?:lunch|work|standup|the\\s+meeting)\\b',
  '\\bwithin\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:minute|hour|day|week|month)s?\\b',
  '\\bin\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:minute|hour|day|week|month)s?\\b',
].join('|');

const TIMELINE_PATTERN = new RegExp(TIMELINE_PATTERN_TEXT, 'gi');
const TIMELINE_DETECTION_PATTERN = new RegExp(TIMELINE_PATTERN_TEXT, 'i');

const TRAILING_TARGET_PATTERN = /^(?:the|a|an|this|that|these|those|my|your|our|their|it|them|[A-Za-z0-9#@<])/;

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

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText || UNCERTAIN_PREFIX_PATTERN.test(normalizedText) || normalizedText.endsWith('?')) {
    return false;
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
