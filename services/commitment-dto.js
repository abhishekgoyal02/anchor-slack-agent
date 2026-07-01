/**
 * @typedef {{
 *   id: number,
 *   title: string,
 *   status: 'Open' | 'Completed',
 *   assignee: string,
 *   githubIssue: number | null,
 *   createdAt: string,
 *   updatedAt: string,
 *   thread: string,
 *   channel: string,
 * }} CommitmentDto
 */

/**
 * Map a storage commitment row into the public MCP DTO.
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @returns {CommitmentDto}
 */
export function toCommitmentDto(commitment) {
  return {
    id: commitment.id,
    title: commitment.text,
    status: commitment.status === 'completed' ? 'Completed' : 'Open',
    assignee: commitment.user_id,
    githubIssue: commitment.github_issue_number,
    createdAt: commitment.created_at,
    updatedAt: commitment.completed_at ?? commitment.created_at,
    thread: commitment.thread_ts,
    channel: commitment.channel_id,
  };
}
