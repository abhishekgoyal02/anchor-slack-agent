/**
 * @typedef {{
 *   title: string,
 *   status: string,
 *   githubIssue: string,
 *   created: string,
 *   dueDate?: string,
 *   summary?: string,
 *   assigneeName?: string,
 * }} CommitmentDto
 */

const STATUS_LABELS = {
  open: '🟡 Open',
  completed: '✅ Completed',
  in_progress: '🔵 In Progress',
  archived: '⚪ Archived',
};

/**
 * Map a storage commitment row into the public MCP DTO.
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @param {{ now?: Date }} [options]
 * @returns {CommitmentDto}
 */
export function toCommitmentDto(commitment, options = {}) {
  const dto = {
    title: commitment.text,
    status: formatCommitmentStatus(commitment.status),
    githubIssue: formatGithubIssue(commitment.github_issue_number),
    created: formatHumanDate(commitment.created_at, options.now),
  };

  if (typeof commitment.summary === 'string' && commitment.summary.trim()) {
    dto.summary = commitment.summary.trim();
  }

  if (typeof commitment.due_date === 'string' && commitment.due_date.trim()) {
    dto.dueDate = formatHumanDate(commitment.due_date, options.now);
  }

  if (typeof commitment.assignee_name === 'string' && commitment.assignee_name.trim()) {
    dto.assigneeName = commitment.assignee_name.trim();
  }

  return dto;
}

/**
 * @param {string | undefined} status
 * @returns {string}
 */
export function formatCommitmentStatus(status) {
  const normalized = (status ?? '').trim().toLowerCase();
  const mapped = STATUS_LABELS[normalized];

  if (mapped) {
    return mapped;
  }

  if (!normalized) {
    return STATUS_LABELS.open;
  }

  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * @param {number | null | undefined} issueNumber
 * @returns {string}
 */
export function formatGithubIssue(issueNumber) {
  if (typeof issueNumber === 'number' && Number.isInteger(issueNumber) && issueNumber > 0) {
    return `GitHub Issue #${issueNumber}`;
  }

  return 'No GitHub issue linked';
}

/**
 * @param {string} rawDate
 * @param {Date} [now]
 * @returns {string}
 */
export function formatHumanDate(rawDate, now = new Date()) {
  const parsedDate = parseCommitmentDate(rawDate);

  if (!parsedDate) {
    return rawDate;
  }

  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dateUtc = Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), parsedDate.getUTCDate());
  const dayDiff = Math.floor((nowUtc - dateUtc) / 86_400_000);

  if (dayDiff === 0) {
    return 'Today';
  }

  if (dayDiff === 1) {
    return 'Yesterday';
  }

  if (dayDiff >= 2 && dayDiff <= 6) {
    return `${dayDiff} days ago`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsedDate);
}

/**
 * @param {string} value
 * @returns {Date | null}
 */
function parseCommitmentDate(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed) ? trimmed.replace(' ', 'T') : trimmed;
  const withTimezone = /Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withTimezone);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}
