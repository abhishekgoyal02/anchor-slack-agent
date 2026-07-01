const UNCERTAIN_PREFIX_PATTERN =
  /^(?:maybe|probably|possibly|i\s+(?:might|may|think|hope|guess|suppose)|we\s+(?:might|may|think|hope|guess|suppose))\b/i;

const ACTION_PATTERN =
  'finish|complete|do|update|review|send|share|submit|create|write|draft|fix|patch|deploy|ship|publish|prepare|handle|take|own|follow up|circle back|schedule|book|confirm|check|investigate|research|look into|sync|merge|push|open|close|test|verify|document|add|remove|change|clean up|refactor|debug|email|message|call';

const STARTER_ACTION_PATTERNS = [
  new RegExp(`\\b(?:i|we)(?:'ll| will)\\s+(?:${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\blet me\\s+(?:${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\bi can\\s+(?:${ACTION_PATTERN})\\b`, 'i'),
  new RegExp(`\\blet's\\s+(?:${ACTION_PATTERN})\\b`, 'i'),
];

const TIMELINE_PATTERN =
  /\b(?:(?:by|before|on)\s+)?(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this evening|next week|within\s+(?:\d+|one|two|three|four|five|six|seven)\s+days?|in\s+(?:\d+|one|two|three|four|five|six|seven)\s+days?\b/gi;

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
 * Detect whether a message likely contains a commitment.
 * @param {string} text
 * @returns {boolean}
 */
export function detectCommitment(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText || UNCERTAIN_PREFIX_PATTERN.test(normalizedText)) {
    return false;
  }

  return STARTER_ACTION_PATTERNS.some((pattern) => {
    const match = pattern.exec(normalizedText);
    if (!match) {
      return false;
    }

    const remainingText = normalizedText.slice(match.index + match[0].length);
    return hasMeaningfulTarget(remainingText);
  });
}
