import { findCommitmentsByText } from '../storage/commitment-store.js';
import { toCommitmentDto } from './commitment-dto.js';

/**
 * @typedef {{
 *   findCommitmentsByText: typeof findCommitmentsByText,
 * }} CommitmentSearchStore
 */

/**
 * Well-known test user IDs that only exist in the test harness.
 * Real Slack user IDs are longer (e.g. U0BBN0MUXS7).
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
  /\bCompletable commitment\b\s+\d{10,}/i,
  /\bAlready completed commitment\b\s+\d{10,}/i,
  /\bOAuth migration completed\b\s+\d{10,}/i,
  /\bPayment gateway (?:linked |owner )?follow-up\b.*\d{10,}/i,
  /\bRaw auth commitment\b.*\d{10,}/i,
  /\bCustomer auth (?:linked|unlinked) work\b\s+\d{10,}/i,
];

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
  const store = deps.store ?? { findCommitmentsByText };
  const query = input.query.trim();

  if (!query) {
    return [];
  }

  const commitments = await store.findCommitmentsByText(query);
  return commitments.filter((row) => !isTestFixture(row)).map(toCommitmentDto);
}
