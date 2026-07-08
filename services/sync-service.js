import { getOpenCommitmentsWithGithubIssues, markCommitmentCompleted } from '../storage/commitment-store.js';
import { getIssue } from './github-service.js';
import { postLoopClosureMessage } from './slack-loop-closure.js';

const DEFAULT_SYNC_INTERVAL_MS = 30000;

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
 *   fetchIssue?: typeof getIssue,
 *   completeCommitment?: typeof markCommitmentCompleted,
 *   postClosureMessage?: typeof postLoopClosureMessage,
 *   client?: import('@slack/web-api').WebClient,
 * }} [options]
 * @returns {Promise<{ checked: number, closed: number, posted: number, completed: number, failed: number }>}
 */
export async function syncGitHubIssueStatuses(options = {}) {
  const logger = options.logger;
  const client = options.client;
  const loadCommitments = options.loadCommitments ?? getOpenCommitmentsWithGithubIssues;
  const fetchIssue = options.fetchIssue ?? getIssue;
  const completeCommitment = options.completeCommitment ?? markCommitmentCompleted;
  const postClosureMessage = options.postClosureMessage ?? postLoopClosureMessage;
  const commitments = /** @type {Array<LinkedCommitment>} */ (await loadCommitments());
  let closed = 0;
  let posted = 0;
  let completed = 0;
  let failed = 0;

  for (const commitment of commitments) {
    if (commitment.status && commitment.status !== 'open') {
      continue;
    }

    if (typeof commitment.github_issue_number !== 'number') {
      continue;
    }

    if (!commitment.channel_id || !commitment.thread_ts) {
      failed += 1;
      logger?.warn?.(`Skipping malformed GitHub issue sync commitment: commitment_id=${commitment.id}`);
      continue;
    }

    try {
      const issue = await fetchIssue(commitment.github_issue_number, { logger });
      if (issue.state === 'closed') {
        closed += 1;

        if (!client) {
          failed += 1;
          logger?.error?.(`Cannot post loop closure without Slack client: commitment_id=${commitment.id}`);
          continue;
        }

        await postClosureMessage(client, buildLoopClosureCommitment(commitment, issue), issue);
        posted += 1;

        const updated = await completeCommitment(commitment.id);
        if (updated) {
          completed += 1;
          logger?.info?.(
            `Marked commitment completed from GitHub issue state: commitment_id=${commitment.id}, issue_number=${issue.number}`,
          );
        } else {
          failed += 1;
          logger?.error?.(`Failed to mark commitment completed: commitment_id=${commitment.id}, no row updated`);
        }
      }
    } catch (error) {
      failed += 1;
      logger?.error?.(
        `Failed to sync GitHub issue status: commitment_id=${commitment.id}, issue_number=${commitment.github_issue_number}, error=${error}`,
      );
    }
  }

  logger?.debug?.(
    `GitHub issue status sync finished: checked=${commitments.length}, closed=${closed}, posted=${posted}, completed=${completed}, failed=${failed}`,
  );
  return { checked: commitments.length, closed, posted, completed, failed };
}

/**
 * Start polling GitHub issue status.
 * @param {{
 *   logger?: SyncLogger,
 *   client?: import('@slack/web-api').WebClient,
 *   intervalMs?: number,
 *   setIntervalImpl?: typeof setInterval,
 *   syncOnce?: typeof syncGitHubIssueStatuses,
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
