import { getAllCommitments } from '../storage/commitment-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACTION_TEXT_LENGTH = 140;
const MIN_SIMILAR_TERM_OVERLAP = 1;
const DEFAULT_SIMILAR_DURATION_DAYS = 1;

const DEADLINE_PATTERNS = [
  /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bbefore\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(tomorrow|today|tonight|this\s+weekend|this\s+week|next\s+week)\b/i,
  /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bwithin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minute|hour|day|week|month)s?\b/i,
  /\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minute|hour|day|week|month)s?\b/i,
];

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'after',
  'before',
  'by',
  'complete',
  'day',
  'days',
  'do',
  'fix',
  'for',
  'friday',
  'hour',
  'hours',
  'i',
  'ill',
  'implement',
  'in',
  'later',
  'monday',
  'month',
  'months',
  'migrate',
  'next',
  'on',
  'saturday',
  'set',
  'sunday',
  'the',
  'this',
  'thursday',
  'today',
  'tomorrow',
  'tonight',
  'to',
  'tuesday',
  'up',
  'wednesday',
  'week',
  'weekend',
  'weeks',
  'will',
  'within',
]);

export const REALITY_CHECK_MICROCOPY = [
  '🐡 Asking the goldfish for a second opinion...',
  '🐧 Low-key this timeline looks solid.',
  '🦦 Plenty of breathing room here.',
  '🐠 Looks clean. Dont fumble the finish.',
  '🦭 Tiny bit ambitious, still very possible.',
  '🪼 Smooth plan. Just dont leave it for later.',
  '🐬 Youre cooking. Keep the momentum.',
  '🦈 Tight window, but not impossible.',
  '🐋 This one should land nicely.',
  '🦀 Pretty reasonable. Future you will thank you.',
];

/**
 * @typedef {{
 *   title: string,
 *   originalText: string,
 *   dueDateLabel: string,
 *   predictedCompletionLabel: string,
 *   similarCount: number,
 *   analysisText: string,
 *   recommendationText: string,
 *   microcopy: string,
 *   primaryButtonLabel: string,
 *   secondaryButtonLabel: string,
 *   primaryValue: string,
 *   secondaryValue: string,
 * }} RealityCheckAnalysis
 */

/**
 * Build an isolated Reality Check analysis for a detected commitment.
 * @param {string} text
 * @param {{
 *   now?: Date,
 *   random?: () => number,
 *   store?: { getAllCommitments: typeof getAllCommitments },
 * }} [deps]
 * @returns {Promise<RealityCheckAnalysis>}
 */
export async function analyzeRealityCheck(text, deps = {}) {
  const normalizedText = normalizeCommitmentText(text);
  const now = deps.now ?? new Date();
  const deadline = extractDeadline(normalizedText, now);
  const store = deps.store ?? { getAllCommitments };
  const history = await loadHistory(store);
  const similarCommitments = getSimilarCommitments(normalizedText, history);
  const averageCompletionDays = getAverageCompletionDays(similarCommitments) ?? DEFAULT_SIMILAR_DURATION_DAYS;
  const predictedCompletion = predictCompletionDate(now, similarCommitments, deadline);
  const shouldRecommendDifferent = shouldRecommendDate(deadline.date, predictedCompletion.date);
  const recommendedLabel = shouldRecommendDifferent ? predictedCompletion.label : deadline.label;

  return {
    title: formatCommitmentTitle(normalizedText),
    originalText: normalizedText,
    dueDateLabel: deadline.label,
    predictedCompletionLabel: predictedCompletion.label,
    similarCount: similarCommitments.length,
    analysisText: buildAnalysisText(normalizedText, averageCompletionDays),
    recommendationText: buildRecommendationText(shouldRecommendDifferent),
    microcopy: getRandomRealityCheckMicrocopy(deps.random),
    primaryButtonLabel: `Keep ${deadline.shortLabel}`,
    secondaryButtonLabel: shouldRecommendDifferent ? `Use ${recommendedLabel}` : 'Proceed Anyway',
    primaryValue: text,
    secondaryValue: shouldRecommendDifferent ? replaceDeadline(text, deadline.raw, recommendedLabel) : text,
  };
}

/**
 * Build a complete safe Reality Check object when analysis cannot run.
 * @param {string} text
 * @param {{ random?: () => number }} [deps]
 * @returns {RealityCheckAnalysis}
 */
export function createFallbackRealityCheck(text, deps = {}) {
  const normalizedText = normalizeCommitmentText(text);
  const deadline = extractDeadline(normalizedText, new Date());

  return {
    title: formatCommitmentTitle(normalizedText),
    originalText: normalizedText,
    dueDateLabel: deadline.label,
    predictedCompletionLabel: deadline.label,
    similarCount: 0,
    analysisText: buildAnalysisText(normalizedText, DEFAULT_SIMILAR_DURATION_DAYS),
    recommendationText: buildRecommendationText(false),
    microcopy: getRandomRealityCheckMicrocopy(deps.random),
    primaryButtonLabel: `Keep ${deadline.shortLabel}`,
    secondaryButtonLabel: 'Proceed Anyway',
    primaryValue: text,
    secondaryValue: text,
  };
}

/**
 * @param {() => number} [random]
 * @returns {string}
 */
export function getRandomRealityCheckMicrocopy(random = Math.random) {
  const index = Math.min(REALITY_CHECK_MICROCOPY.length - 1, Math.floor(random() * REALITY_CHECK_MICROCOPY.length));
  return REALITY_CHECK_MICROCOPY[index];
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeCommitmentText(text) {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} text
 * @param {Date} now
 * @returns {{ raw: string, label: string, shortLabel: string, date: Date | null }}
 */
function extractDeadline(text, now) {
  for (const pattern of DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      const raw = match[0];
      const label = formatDeadlineLabel(raw);
      return {
        raw,
        label,
        shortLabel: label,
        date: estimateDeadlineDate(label, now),
      };
    }
  }

  return { raw: '', label: 'the stated date', shortLabel: 'Date', date: null };
}

/**
 * @param {string} raw
 * @returns {string}
 */
function formatDeadlineLabel(raw) {
  const cleaned = raw
    .replace(/^(?:by|before|on)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned
    .split(' ')
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * @param {Date} now
 * @param {import('../storage/commitment-store.js').Commitment[]} similarCommitments
 * @param {{ date: Date | null, label: string }} deadline
 * @returns {{ label: string, date: Date | null }}
 */
function predictCompletionDate(now, similarCommitments, deadline) {
  const averageCompletionDays = getAverageCompletionDays(similarCommitments);
  if (averageCompletionDays !== null) {
    const date = new Date(now.getTime() + averageCompletionDays * DAY_MS);
    return { label: formatWeekday(date), date };
  }

  return { label: deadline.label, date: deadline.date };
}

/**
 * @param {import('../storage/commitment-store.js').Commitment[]} commitments
 * @returns {number | null}
 */
function getAverageCompletionDays(commitments) {
  const durations = commitments
    .map((commitment) => getCompletionDurationDays(commitment.created_at, commitment.completed_at))
    .filter((duration) => duration !== null);

  if (durations.length === 0) {
    return null;
  }

  return Math.max(1, Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length));
}

/**
 * @param {string | null | undefined} createdAt
 * @param {string | null | undefined} completedAt
 * @returns {number | null}
 */
function getCompletionDurationDays(createdAt, completedAt) {
  const created = parseStoredDate(createdAt);
  const completed = parseStoredDate(completedAt);

  if (!created || !completed || completed < created) {
    return null;
  }

  return Math.max(1, Math.ceil((completed.getTime() - created.getTime()) / DAY_MS));
}

/**
 * @param {{ getAllCommitments: typeof getAllCommitments }} store
 * @returns {Promise<import('../storage/commitment-store.js').Commitment[]>}
 */
async function loadHistory(store) {
  try {
    return await store.getAllCommitments();
  } catch {
    return [];
  }
}

/**
 * @param {string} text
 * @param {import('../storage/commitment-store.js').Commitment[]} commitments
 * @returns {import('../storage/commitment-store.js').Commitment[]}
 */
function getSimilarCommitments(text, commitments) {
  const terms = getSignificantTerms(text);
  if (terms.length === 0) {
    return [];
  }

  return commitments.filter((commitment) => {
    const commitmentTerms = new Set(getSignificantTerms(commitment.text ?? ''));
    const overlap = terms.filter((term) => commitmentTerms.has(term)).length;
    return overlap >= MIN_SIMILAR_TERM_OVERLAP;
  });
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function getSignificantTerms(text) {
  return normalizeSearchText(text)
    .split(' ')
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeSearchText(text) {
  return text
    .toLowerCase()
    .replace(/\bi['’]?ll\b/g, 'ill')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {Date | null} deadlineDate
 * @param {Date | null} predictedDate
 * @returns {boolean}
 */
function shouldRecommendDate(deadlineDate, predictedDate) {
  return Boolean(deadlineDate && predictedDate && predictedDate.getTime() !== deadlineDate.getTime());
}

/**
 * @param {number} similarCount
 * @param {boolean} isTight
 * @returns {string}
 */
function buildAnalysisText(text, averageCompletionDays) {
  const duration = averageCompletionDays === 1 ? '~1 day' : `~${averageCompletionDays} days`;
  return `Similar ${getTopicLabel(text)} work usually takes ${duration}.`;
}

/**
 * @param {boolean} isTight
 * @returns {string}
 */
function buildRecommendationText(isTight) {
  return isTight ? 'This looks tight, but possible.' : 'This looks very realistic.';
}

/**
 * @param {string} text
 * @returns {string}
 */
function getTopicLabel(text) {
  const lowerText = text.toLowerCase();
  if (/\b(auth|authentication|oauth|login)\b/.test(lowerText)) {
    return 'authentication';
  }

  if (/\b(docker|container)\b/.test(lowerText)) {
    return 'Docker';
  }

  if (/\b(api|endpoint)\b/.test(lowerText)) {
    return 'API';
  }

  if (/\b(deploy|deployment|release|ship)\b/.test(lowerText)) {
    return 'deployment';
  }

  if (/\b(pr|pull request|review)\b/.test(lowerText)) {
    return 'PR';
  }

  if (/\b(readme|docs|documentation)\b/.test(lowerText)) {
    return 'documentation';
  }

  return 'similar';
}

/**
 * @param {string} text
 * @returns {string}
 */
function formatCommitmentTitle(text) {
  const sentence = text.split(/[.!?]\s/)[0] || text;
  const cleaned = sentence
    .replace(/^(?:i['’]?ll|ill|i\s+will|we['’]?ll|we\s+will|we\s+should|need\s+to|let['’]?s|lets)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const titled = capitalizeFirstWord(cleaned);

  if (titled.length <= MAX_ACTION_TEXT_LENGTH) {
    return ensureNoTerminalPunctuation(titled);
  }

  return `${titled.slice(0, MAX_ACTION_TEXT_LENGTH - 1).trim()}...`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function capitalizeFirstWord(text) {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

/**
 * @param {string} text
 * @returns {string}
 */
function ensureNoTerminalPunctuation(text) {
  return text.replace(/[.!?]+$/g, '');
}

/**
 * @param {string} text
 * @param {string} rawDeadline
 * @param {string} recommendedLabel
 * @returns {string}
 */
function replaceDeadline(text, rawDeadline, recommendedLabel) {
  if (!rawDeadline) {
    return text;
  }

  const replacement = rawDeadline.replace(
    new RegExp(escapeRegExp(formatDeadlineLabel(rawDeadline)), 'i'),
    recommendedLabel,
  );
  return text.replace(rawDeadline, replacement);
}

/**
 * @param {string} value
 * @param {Date} now
 * @returns {Date | null}
 */
function estimateDeadlineDate(value, now) {
  const normalized = value.toLowerCase();
  if (normalized === 'today' || normalized === 'tonight') {
    return startOfDay(now);
  }

  if (normalized === 'tomorrow') {
    return addDays(startOfDay(now), 1);
  }

  if (normalized === 'this weekend') {
    return nextWeekday(now, 6);
  }

  if (normalized === 'this week') {
    return nextWeekday(now, 5);
  }

  if (normalized === 'next week') {
    return addDays(startOfDay(now), 7);
  }

  const weekday = getWeekdayIndex(normalized);
  return weekday === null ? null : nextWeekday(now, weekday);
}

/**
 * @param {Date} date
 * @returns {Date}
 */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * @param {Date} now
 * @param {number} weekday
 * @returns {Date}
 */
function nextWeekday(now, weekday) {
  const current = now.getDay();
  const daysUntil = (weekday - current + 7) % 7 || 7;
  return addDays(startOfDay(now), daysUntil);
}

/**
 * @param {string} value
 * @returns {number | null}
 */
function getWeekdayIndex(value) {
  const index = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(value);
  return index === -1 ? null : index;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatWeekday(date) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
}

/**
 * @param {string | null | undefined} value
 * @returns {Date | null}
 */
function parseStoredDate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
