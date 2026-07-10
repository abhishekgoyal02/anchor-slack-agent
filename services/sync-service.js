import {
  clearGithubSyncFailure,
  getGithubSyncEligibleCommitments,
  getGithubSyncStartupSummary,
  markCommitmentCompleted,
  recordGithubSyncFailure,
} from '../storage/commitment-store.js';
import { isTestFixture } from './commitment-search-service.js';
import { getIssue } from './github-service.js';
import { postLoopClosureMessage } from './slack-loop-closure.js';

const DEFAULT_SYNC_INTERVAL_MS = 30000;
const DEFAULT_MAX_SYNC_FAILURES = 3;

/**
 * @typedef {{
 *   id: number,
 *   text: string,
 *   channel_id: string,
 *   thread_ts: string,
 *   message_ts: string,
 *   user_id?: string | null,
 *   status?: string,
 *   github_issue_number: number | null,
 *   github_issue_url: string | null,
 *   github_sync_failure_count?: number | null,
 *   github_sync_quarantined_at?: string | null,
 *   github_sync_quarantine_reason?: string | null,
 * }} LinkedCommitment
 */

/**
 * @typedef {{
 *   debug?: (message: string) => void,
 *   info?: (message: string) => void,
 *   warn?: (message: string) => void,
 *   error?: (message: string) => void,
 * }} SyncLogger
 */

/**
 * Sync open linked commitments with their GitHub issue state.
 * @param {{
 *   logger?: SyncLogger,
 *   loadCommitments?: () => Promise<Array<LinkedCommitment>>,
 *   loadStartupSummary?: typeof getGithubSyncStartupSummary,
 *   fetchIssue?: typeof getIssue,
 *   completeCommitment?: typeof markCommitmentCompleted,
 *   recordFailure?: typeof recordGithubSyncFailure,
 *   clearFailure?: typeof clearGithubSyncFailure,
 *   postClosureMessage?: typeof postLoopClosureMessage,
 *   client?: import('@slack/web-api').WebClient,
 *   maxSyncFailures?: number,
 * }} [options]
 * @returns {Promise<{ checked: number, closed: number, posted: number, completed: number, failed: number }>}
 */
export async function syncGitHubIssueStatuses(options = {}) {
  const logger = options.logger;
  const client = options.client;
  const loadCommitments = options.loadCommitments ?? getGithubSyncEligibleCommitments;
  const fetchIssue = options.fetchIssue ?? getIssue;
  const completeCommitment = options.completeCommitment ?? markCommitmentCompleted;
  const recordFailure = options.recordFailure ?? recordGithubSyncFailure;
  const clearFailure = options.clearFailure ?? clearGithubSyncFailure;
  const postClosureMessage = options.postClosureMessage ?? postLoopClosureMessage;
  const maxSyncFailures = getMaxSyncFailures(options.maxSyncFailures);
  const commitments = /** @type {Array<LinkedCommitment>} */ (await loadCommitments());
  const eligibleCommitments = getEligibleSyncCommitments(commitments, { logger });
  let closed = 0;
  let posted = 0;
  let completed = 0;
  let failed = 0;

  for (const commitment of eligibleCommitments) {
    if (!isValidIssueNumber(commitment.github_issue_number)) {
      continue;
    }

    if (!commitment.channel_id || !commitment.thread_ts) {
      failed += 1;
      logger?.warn?.(`Skipping malformed GitHub issue sync commitment: commitment_id=${commitment.id}`);
      continue;
    }

    try {
      const issue = await fetchIssue(commitment.github_issue_number, { logger });
      if (hasSyncFailureState(commitment)) {
        const restored = await clearFailure(commitment.id);
        if (restored) {
          logger?.info?.(
            `GitHub synchronization restored: commitment_id=${commitment.id}, issue_number=${commitment.github_issue_number}`,
          );
        }
      }

      if (issue.state === 'closed') {
        closed += 1;

        const updated = await completeCommitment(commitment.id);
        if (!updated) {
          logger?.debug?.(
            `Commitment already completed before GitHub sync notification: commitment_id=${commitment.id}, issue_number=${issue.number}`,
          );
          continue;
        }

        completed += 1;
        logger?.info?.(
          `Marked commitment completed from GitHub issue state: commitment_id=${commitment.id}, issue_number=${issue.number}`,
        );

        if (!client) {
          failed += 1;
          logger?.error?.(`Cannot post loop closure without Slack client: commitment_id=${commitment.id}`);
          continue;
        }

        try {
          await postClosureMessage(client, buildLoopClosureCommitment(commitment, issue), issue);
          posted += 1;
        } catch (error) {
          failed += 1;
          logger?.error?.(
            `Loop Closure Slack delivery failed after GitHub sync completed: commitment_id=${commitment.id}, issue_number=${issue.number}, reason=${getSlackDeliveryFailureReason(error)}`,
          );
        }
      }
    } catch (error) {
      failed += 1;
      const reason = getSyncFailureReason(error);
      const failureState = await recordFailure(commitment.id, { reason, maxFailures: maxSyncFailures });
      if (failureState.quarantined) {
        logger?.warn?.(
          `Commitment quarantined after repeated GitHub sync failures: commitment_id=${commitment.id}, issue_number=${commitment.github_issue_number}, failures=${failureState.failureCount}, reason=${reason}`,
        );
      } else {
        logger?.warn?.(
          `Retrying GitHub issue after temporary failure: commitment_id=${commitment.id}, issue_number=${commitment.github_issue_number}, failures=${failureState.failureCount}, reason=${reason}`,
        );
      }
    }
  }

  logger?.debug?.(
    `GitHub issue status sync finished: checked=${commitments.length}, eligible=${eligibleCommitments.length}, closed=${closed}, posted=${posted}, completed=${completed}, failed=${failed}`,
  );
  return { checked: commitments.length, closed, posted, completed, failed };
}

/**
 * @param {LinkedCommitment[]} commitments
 * @param {{ logger?: SyncLogger }} options
 * @returns {LinkedCommitment[]}
 */
export function getEligibleSyncCommitments(commitments, { logger } = {}) {
  const seenKeys = new Set();
  const eligible = [];

  for (const commitment of commitments) {
    const rejectionReason = getSyncRejectionReason(commitment, seenKeys);
    if (rejectionReason) {
      logSyncSkip(logger, commitment, rejectionReason);
      continue;
    }

    seenKeys.add(getDuplicateKey(commitment));
    eligible.push(commitment);
  }

  return eligible;
}

/**
 * @param {LinkedCommitment} commitment
 * @param {Set<string>} seenKeys
 * @returns {string}
 */
function getSyncRejectionReason(commitment, seenKeys) {
  if (commitment.status && commitment.status !== 'open') {
    return 'not_open';
  }

  if (
    isTestFixture(
      /** @type {import('../storage/commitment-store.js').Commitment} */ (/** @type {unknown} */ (commitment)),
    )
  ) {
    return 'fixture';
  }

  if (!isValidIssueNumber(commitment.github_issue_number)) {
    return 'invalid_issue_number';
  }

  if (!isValidIssueUrl(commitment.github_issue_url, commitment.github_issue_number)) {
    return 'invalid_github_url';
  }

  if (commitment.github_sync_quarantined_at) {
    return 'quarantined';
  }

  if (seenKeys.has(getDuplicateKey(commitment))) {
    return 'duplicate';
  }

  return '';
}

/**
 * @param {number | null} issueNumber
 * @returns {issueNumber is number}
 */
function isValidIssueNumber(issueNumber) {
  return typeof issueNumber === 'number' && Number.isInteger(issueNumber) && issueNumber > 0;
}

/**
 * @param {string | null} issueUrl
 * @param {number | null} issueNumber
 * @returns {boolean}
 */
function isValidIssueUrl(issueUrl, issueNumber) {
  const validIssueNumber = isValidIssueNumber(issueNumber) ? issueNumber : null;
  if (typeof issueUrl !== 'string' || !issueUrl.trim() || validIssueNumber === null) {
    return false;
  }

  return new RegExp(`/issues/${validIssueNumber}(?:$|[/?#])`).test(issueUrl.trim());
}

/**
 * @param {LinkedCommitment} commitment
 * @returns {string}
 */
function getDuplicateKey(commitment) {
  return `${commitment.text.trim().toLowerCase()}|${commitment.github_issue_number}|${commitment.github_issue_url?.trim().toLowerCase()}`;
}

/**
 * @param {SyncLogger | undefined} logger
 * @param {LinkedCommitment} commitment
 * @param {string} reason
 */
function logSyncSkip(logger, commitment, reason) {
  const issueNumber = commitment.github_issue_number ?? 'none';
  if (reason === 'fixture') {
    logger?.warn?.(`Skipped fixture commitment: commitment_id=${commitment.id}, issue_number=${issueNumber}`);
    return;
  }

  if (reason === 'invalid_issue_number' || reason === 'invalid_github_url') {
    logger?.warn?.(`Skipped invalid GitHub link: commitment_id=${commitment.id}, issue_number=${issueNumber}`);
    return;
  }

  if (reason === 'duplicate') {
    logger?.warn?.(
      `Skipped duplicated development commitment: commitment_id=${commitment.id}, issue_number=${issueNumber}`,
    );
    return;
  }

  if (reason === 'quarantined') {
    logger?.warn?.(
      `Skipped quarantined GitHub sync commitment: commitment_id=${commitment.id}, issue_number=${issueNumber}`,
    );
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getSyncFailureReason(error) {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return `github_status_${error.status}`;
  }

  return 'github_request_failed';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getSlackDeliveryFailureReason(error) {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object' && 'error' in error.data) {
      return String(error.data.error);
    }

    if ('message' in error) {
      return String(error.message);
    }
  }

  return 'slack_delivery_failed';
}

/**
 * @param {number | undefined} configuredMaxFailures
 * @returns {number}
 */
function getMaxSyncFailures(configuredMaxFailures) {
  if (
    typeof configuredMaxFailures === 'number' &&
    Number.isFinite(configuredMaxFailures) &&
    configuredMaxFailures > 0
  ) {
    return Math.floor(configuredMaxFailures);
  }

  const envValue = Number.parseInt(process.env.GITHUB_SYNC_MAX_FAILURES ?? '', 10);
  return Number.isFinite(envValue) && envValue > 0 ? envValue : DEFAULT_MAX_SYNC_FAILURES;
}

/**
 * @param {LinkedCommitment} commitment
 * @returns {boolean}
 */
function hasSyncFailureState(commitment) {
  return Boolean((commitment.github_sync_failure_count ?? 0) > 0 || commitment.github_sync_quarantined_at);
}

/**
 * Start polling GitHub issue status.
 * @param {{
 *   logger?: SyncLogger,
 *   client?: import('@slack/web-api').WebClient,
 *   intervalMs?: number,
 *   setIntervalImpl?: typeof setInterval,
 *   syncOnce?: typeof syncGitHubIssueStatuses,
 *   loadStartupSummary?: typeof getGithubSyncStartupSummary,
 * }} [options]
 * @returns {NodeJS.Timeout}
 */

export function startSyncService(options = {}) {
  const logger = options.logger;
  const client = options.client;
  const configuredIntervalMs = options.intervalMs;
  const intervalMs =
    typeof configuredIntervalMs === 'number' && Number.isFinite(configuredIntervalMs) && configuredIntervalMs > 0
      ? configuredIntervalMs
      : DEFAULT_SYNC_INTERVAL_MS;
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const syncOnce = options.syncOnce ?? syncGitHubIssueStatuses;
  const loadStartupSummary = options.loadStartupSummary ?? getGithubSyncStartupSummary;
  let isSyncing = false;

  logger?.info?.(`Starting GitHub issue status sync service: interval_ms=${intervalMs}`);
  const runSync = () => {
    if (isSyncing) {
      logger?.warn?.('Skipping GitHub issue status sync because a previous sync is still running');
      return;
    }

    isSyncing = true;
    syncOnce({
      logger,
      client,
    })
      .catch((error) => {
        logger?.error?.(`GitHub issue status sync failed: ${error}`);
      })
      .finally(() => {
        isSyncing = false;
      });
  };

  void loadStartupSummary()
    .then((summary) => {
      logger?.info?.(
        `GitHub Sync Startup: eligible_commitments=${summary.eligible}, fixture_commitments_ignored=${summary.fixture}, quarantined_commitments=${summary.quarantined}`,
      );
    })
    .catch((error) => {
      logger?.warn?.(`Unable to load GitHub sync startup summary: ${error}`);
    });
  runSync();
  return setIntervalImpl(runSync, intervalMs);
}

/**
 * @param {LinkedCommitment} commitment
 * @param {{ title?: string, body?: string }} issue
 * @returns {import('./slack-loop-closure.js').LoopClosureCommitment}
 */
function buildLoopClosureCommitment(commitment, issue) {
  return {
    completion_description: getCommitmentDescriptionFromIssue(issue, commitment),
    user_id: commitment.user_id,
    channel_id: commitment.channel_id,
    thread_ts: commitment.thread_ts,
  };
}

/**
 * Use already-generated Context Snapshot wording from the GitHub issue.
 * @param {{ title?: string, body?: string }} issue
 * @param {LinkedCommitment} commitment
 * @returns {string}
 */
function getCommitmentDescriptionFromIssue(issue, commitment) {
  const snapshotSummary = extractContextSnapshotSummary(issue.body);
  if (snapshotSummary) {
    return snapshotSummary;
  }

  const issueTitle = issue.title?.trim();
  if (issueTitle) {
    return issueTitle;
  }

  return commitment.text;
}

/**
 * @param {string | undefined} issueBody
 * @returns {string}
 */
export function extractContextSnapshotSummary(issueBody) {
  if (!issueBody) {
    return '';
  }

  const lines = issueBody.split(/\r?\n/);
  const summaryLines = [];
  let inSummarySection = false;

  for (const line of lines) {
    if (line.startsWith('## ') && inSummarySection) {
      break;
    }

    if (line.trim() === '## Summary') {
      inSummarySection = true;
      continue;
    }

    if (inSummarySection && line.trim()) {
      summaryLines.push(line.trim());
    }
  }

  return summaryLines.join(' ').trim();
}
