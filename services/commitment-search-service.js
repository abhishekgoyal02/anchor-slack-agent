import { findCommitmentsByText } from '../storage/commitment-store.js';
import { toCommitmentDto } from './commitment-dto.js';

/**
 * @typedef {{
 *   findCommitmentsByText: typeof findCommitmentsByText,
 * }} CommitmentSearchStore
 */

/**
 * Search commitments through the business service layer.
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
  return commitments.map(toCommitmentDto);
}
