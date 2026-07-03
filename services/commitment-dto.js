/**
 * @typedef {{
 *   title: string,
 *   status: string,
 *   githubIssue?: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   assignee?: string,
 * }} CommitmentDto
 */

const STATUS_LABELS = {
  open: 'Open',
  completed: 'Completed',
  in_progress: 'In Progress',
  archived: 'Archived',
};

/**
 * Map a storage commitment row into the public MCP DTO.
 * @param {import('../storage/commitment-store.js').Commitment} commitment
 * @returns {CommitmentDto}
 */
export function toCommitmentDto(commitment) {
  const dto = {
    title: commitment.text,
    status: formatCommitmentStatus(commitment.status),
    createdAt: formatTimestamp(commitment.created_at),
    updatedAt: formatTimestamp(commitment.completed_at || commitment.created_at),
  };

  const assignee = formatSlackMention(commitment.assignee_name || commitment.user_id);
  if (assignee) {
    dto.assignee = assignee;
  }

  const githubIssue = formatGithubIssue(commitment.github_issue_number);
  if (githubIssue) {
    dto.githubIssue = githubIssue;
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
 * @returns {string | null}
 */
export function formatGithubIssue(issueNumber) {
  if (typeof issueNumber === 'number' && Number.isInteger(issueNumber) && issueNumber > 0) {
    return String(issueNumber);
  }

  return null;
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

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function formatTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  return value.trim();
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function formatSlackMention(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const mentionMatch = trimmed.match(/^<@([UW][A-Z0-9]+)>$/i);
  if (mentionMatch) {
    return `<@${mentionMatch[1]}>`;
  }

  if (/^[UW][A-Z0-9]{2,}$/i.test(trimmed)) {
    return `<@${trimmed}>`;
  }

  return trimmed;
}
