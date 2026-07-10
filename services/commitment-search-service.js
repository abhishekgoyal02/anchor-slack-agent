import { findCommitmentsByText, getAllCommitments } from '../storage/commitment-store.js';
import { toCommitmentDto } from './commitment-dto.js';

/**
 * @typedef {{
 *   findCommitmentsByText: typeof findCommitmentsByText,
 *   getAllCommitments?: typeof getAllCommitments,
 * }} CommitmentSearchStore
 */

/**
 * Well-known test user IDs that only exist in the test harness.
 * Real Slack user IDs are longer and workspace-specific.
 * @type {ReadonlySet<string>}
 */
const TEST_USER_IDS = new Set(['U123', 'U999']);

/**
 * Patterns in commitment text that indicate test-harness rows.
 * Each regex is tested against the full text. Order does not matter.
 * @type {readonly RegExp[]}
 */
const TEST_TEXT_PATTERNS = [
  /fixture-filter-\d+/i,
  /open-filter-\d+/i,
  /\bTest commitment\b.*\d{10,}/i,
  /\bTest GitHub metadata\b.*\d{10,}/i,
  /\bLinked commitment\b\s+\d{10,}/i,
  /\bUnlinked commitment\b\s+\d{10,}/i,
  /\bRelinked commitment\b/i,
  /\bCompletable commitment\b\s+\d{10,}/i,
  /\bAlready completed commitment\b\s+\d{10,}/i,
  /\bDisabled GitHub sync\b\s+\d{10,}/i,
  /\bProduction sync (?:eligible|quarantined)\b\s+\d{10,}/i,
  /\bOAuth migration completed\b\s+\d{10,}/i,
  /\bPayment gateway (?:linked |owner )?follow-up\b.*\d{10,}/i,
  /\bRaw auth commitment\b.*\d{10,}/i,
  /\bCustomer auth (?:linked|unlinked) work\b\s+\d{10,}/i,
  /\b(?:temporary recovery|recovery row|migration placeholder|placeholder row)\b/i,
  /\bdummy\b/i,
  /\bsample row\b/i,
  /\bseed data\b/i,
];

const STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'any',
  'anything',
  'are',
  'before',
  'commitment',
  'commitments',
  'doing',
  'find',
  'for',
  'handling',
  'is',
  'list',
  'me',
  'on',
  'owns',
  'please',
  'responsible',
  'related',
  'search',
  'show',
  'the',
  'this',
  'to',
  'need',
  'needs',
  's',
  'still',
  'what',
  'who',
  'whos',
  'work',
  'working',
]);

const STATUS_QUERY_WORDS = new Set(['open', 'completed', 'overdue', 'today', 'todays']);
const ACTIVE_STATUSES = new Set(['open', 'in progress', 'blocked']);
const OVERDUE_STATUSES = new Set(['open', 'in progress']);
const BLOCKER_KEYWORDS = new Set([
  'api',
  'auth',
  'authentication',
  'deployment',
  'frontend',
  'github',
  'launch',
  'login',
  'migration',
  'mcp',
  'oauth',
  'production',
  'release',
  'security',
]);

const TERM_SYNONYMS = {
  auth: ['authentication', 'oauth'],
  authentication: ['auth', 'oauth'],
  oauth: ['auth', 'authentication'],
  deploy: ['deployment', 'production', 'release'],
  deployment: ['deploy', 'production', 'release'],
  docs: ['documentation'],
  documentation: ['docs'],
  gemini: ['google'],
  github: ['git'],
};

const OWNERSHIP_QUERY_PATTERN =
  /\b(?:who\s+(?:owns?|is\s+(?:working\s+on|handling|doing|responsible\s+for)|'?s\s+(?:working\s+on|handling|doing))|whos\s+(?:working\s+on|handling|doing))\b/;

/**
 * Returns true when a storage row is a test-harness fixture that should
 * never appear in Ask Anchor responses.
 *
 * A row is considered a fixture when:
 *   1. Its user_id is a well-known test ID (U123, U999), OR
 *   2. Its text matches any known test-harness pattern.
 *
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @returns {boolean}
 */
export function isTestFixture(commitment) {
  if (TEST_USER_IDS.has(commitment.user_id)) {
    return true;
  }

  const text = commitment.text ?? '';
  return TEST_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Search commitments through the business service layer.
 *
 * Test and fixture rows are filtered out before DTO conversion so they
 * never reach Ask Anchor or any other consumer of the search results.
 *
 * @param {{ query: string }} input
 * @param {{ store?: CommitmentSearchStore }} [deps]
 * @returns {Promise<import('./commitment-dto.js').CommitmentDto[]>}
 */
export async function searchCommitments(input, deps = {}) {
  const store = deps.store ?? { findCommitmentsByText, getAllCommitments };
  const query = normalizeWhitespace(input.query);

  if (!query) {
    return [];
  }

  const intent = getSearchIntent(query);
  const shouldFilterByIntent = Boolean(store.getAllCommitments);
  const commitments = await loadCommitmentsForQuery(query, store);

  return commitments
    .filter((row) => !isTestFixture(row))
    .filter((row) => !shouldFilterByIntent || matchesIntent(row, intent))
    .map(toCommitmentDto);
}

/**
 * @param {string} query
 * @param {CommitmentSearchStore} store
 * @returns {Promise<import('../storage/commitment-store.js').Commitment[]>}
 */
async function loadCommitmentsForQuery(query, store) {
  if (store.getAllCommitments) {
    return store.getAllCommitments();
  }

  return store.findCommitmentsByText(getFallbackTextQuery(query));
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/**
 * @param {string} query
 * @returns {string}
 */
function getFallbackTextQuery(query) {
  const intent = getSearchIntent(query);
  return intent.terms[0] ?? query;
}

/**
 * @param {string} query
 * @returns {{
 *   kind: 'topic' | 'ownership' | 'open' | 'completed' | 'overdue' | 'today' | 'blockers',
 *   terms: string[],
 * }}
 */
function getSearchIntent(query) {
  const normalized = normalizeSearchText(query);

  if (isBlockerQuery(normalized)) {
    return { kind: 'blockers', terms: getExpandedTerms(normalized) };
  }

  if (/\boverdue\b/.test(normalized)) {
    return { kind: 'overdue', terms: [] };
  }

  if (/\b(?:today|todays)\b/.test(normalized)) {
    return { kind: 'today', terms: [] };
  }

  if (/\bcompleted\b/.test(normalized)) {
    return { kind: 'completed', terms: [] };
  }

  if (/\bopen\b/.test(normalized)) {
    return { kind: 'open', terms: [] };
  }

  const terms = getExpandedTerms(normalized);
  if (OWNERSHIP_QUERY_PATTERN.test(normalized)) {
    return { kind: 'ownership', terms };
  }

  return { kind: 'topic', terms };
}

/**
 * @param {string} normalizedQuery
 * @returns {boolean}
 */
function isBlockerQuery(normalizedQuery) {
  return /\b(?:blocking|blockers?|delaying|finished|remains?)\b/.test(normalizedQuery);
}

/**
 * @param {string} query
 * @returns {string[]}
 */
function getExpandedTerms(query) {
  const terms = normalizeSearchText(query)
    .split(' ')
    .map(singularize)
    .filter((term) => term && !STOP_WORDS.has(term) && !STATUS_QUERY_WORDS.has(term));
  const expanded = new Set(terms);

  for (const term of terms) {
    for (const synonym of TERM_SYNONYMS[term] ?? []) {
      expanded.add(synonym);
    }
  }

  return [...expanded];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeSearchText(value) {
  return value
    .toLowerCase()
    .replace(/\bwho['’]?s\b/g, 'whos')
    .replace(/\btoday['’]?s\b/g, 'todays')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} value
 * @returns {string}
 */
function singularize(value) {
  if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss')) {
    return value.slice(0, -1);
  }

  return value;
}

/**
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @param {ReturnType<typeof getSearchIntent>} intent
 * @returns {boolean}
 */
function matchesIntent(commitment, intent) {
  if (intent.kind === 'open') {
    return isUnfinished(commitment);
  }

  if (intent.kind === 'completed') {
    return normalizeStatus(commitment.status) === 'completed';
  }

  if (intent.kind === 'overdue') {
    return isOverdue(commitment);
  }

  if (intent.kind === 'today') {
    return isSameUtcDate(commitment.due_date, new Date()) || isSameUtcDate(commitment.created_at, new Date());
  }

  if (intent.kind === 'blockers') {
    return isLikelyBlocker(commitment, intent.terms);
  }

  if (intent.terms.length === 0) {
    return false;
  }

  return matchesAnyTerm(commitment.text, intent.terms);
}

/**
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @param {string[]} terms
 * @returns {boolean}
 */
function isLikelyBlocker(commitment, terms) {
  if (!isUnfinished(commitment)) {
    return false;
  }

  if (isBeforeToday(commitment.due_date)) {
    return true;
  }

  const blockerTerms = new Set([...terms, ...BLOCKER_KEYWORDS]);
  return matchesAnyTerm(commitment.text, [...blockerTerms]);
}

/**
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @returns {boolean}
 */
function isUnfinished(commitment) {
  return ACTIVE_STATUSES.has(normalizeStatus(commitment.status));
}

/**
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @returns {boolean}
 */
function isOverdue(commitment) {
  return OVERDUE_STATUSES.has(normalizeStatus(commitment.status)) && isBeforeToday(commitment.due_date);
}

/**
 * @param {string | undefined} status
 * @returns {string}
 */
function normalizeStatus(status) {
  return (status ?? 'open').trim().toLowerCase().replace(/_/g, ' ');
}

/**
 * @param {string | null | undefined} value
 * @param {string[]} terms
 * @returns {boolean}
 */
function matchesAnyTerm(value, terms) {
  const normalized = normalizeSearchText(value ?? '');
  const words = normalized.split(' ').filter(Boolean).map(singularize);

  return terms.some((term) => {
    if (words.includes(term)) {
      return true;
    }

    return words.some((word) => isTypoMatch(word, term));
  });
}

/**
 * @param {string} word
 * @param {string} term
 * @returns {boolean}
 */
function isTypoMatch(word, term) {
  return term.length >= 5 && word.length >= 5 && Math.abs(word.length - term.length) <= 1 && editDistance(word, term) <= 1;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      previous[rightIndex] = Math.min(previous[rightIndex] + 1, previous[rightIndex - 1] + 1, diagonal + cost);
      diagonal = above;
    }
  }

  return previous[right.length];
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function isBeforeToday(value) {
  const date = parseStoredDate(value);
  if (!date) {
    return false;
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dateUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return dateUtc < todayUtc;
}

/**
 * @param {string | null | undefined} value
 * @param {Date} target
 * @returns {boolean}
 */
function isSameUtcDate(value, target) {
  const date = parseStoredDate(value);
  if (!date) {
    return false;
  }

  return (
    date.getUTCFullYear() === target.getUTCFullYear() &&
    date.getUTCMonth() === target.getUTCMonth() &&
    date.getUTCDate() === target.getUTCDate()
  );
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
