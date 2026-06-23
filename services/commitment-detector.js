const UNCERTAIN_PREFIX_PATTERN =
  /^(?:maybe|probably|possibly|i\s+(?:might|may|think|hope|guess|suppose)|we\s+(?:might|may|think|hope|guess|suppose))\b/i;

const STARTER_ACTION_PATTERNS = [
  /\b(?:i|we)(?:'ll| will)\s+(?:finish|complete|update|review|send|share|submit|create|write|draft|fix|patch|deploy|ship|publish|prepare|handle|take|own|follow up|circle back|schedule|book|confirm|check|investigate|look into|sync|merge|push|open|close|test|verify|document|add|remove|change|clean up|refactor|debug|email|message|call)\b/i,
  /\blet me\s+(?:finish|complete|update|review|send|share|submit|create|write|draft|fix|patch|deploy|ship|publish|prepare|handle|take|own|follow up|circle back|schedule|book|confirm|check|investigate|look into|sync|merge|push|open|close|test|verify|document|add|remove|change|clean up|refactor|debug|email|message|call)\b/i,
  /\bi can\s+(?:handle|take|own|finish|complete|update|review|send|share|submit|create|write|draft|fix|patch|deploy|ship|publish|prepare|follow up|circle back|schedule|book|confirm|check|investigate|look into|sync|merge|push|open|close|test|verify|document|add|remove|change|clean up|refactor|debug|email|message|call)\b/i,
  /\blet's\s+(?:finish|complete|update|review|send|share|submit|create|write|draft|fix|patch|deploy|ship|publish|prepare|handle|take|follow up|circle back|schedule|book|confirm|check|investigate|look into|sync|merge|push|open|close|test|verify|document|add|remove|change|clean up|refactor|debug)\b/i,
];

const TRAILING_TARGET_PATTERN = /\s+(?:the|a|an|this|that|these|those|my|your|our|their|it|them|[A-Za-z0-9#@<])/;

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
    return TRAILING_TARGET_PATTERN.test(remainingText);
  });
}
