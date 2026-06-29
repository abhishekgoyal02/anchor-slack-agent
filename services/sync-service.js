import {
  getOpenCommitmentsWithGithubIssues,
  markCommitmentCompleted,
} from '../storage/commitment-store.js';
import { getIssue } from './github-service.js';
import { buildCommitmentCompletedCard } from '../listeners/views/commitment-card.js';
const DEFAULT_SYNC_INTERVAL_MS = 300000;

/**
 * @typedef {{
 *   id: number,
 *   text: string,
 *   channel_id: string,
 *   thread_ts: string,
 *   message_ts: string,
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
 *   client?: import('@slack/web-api').WebClient,
 * }} [options]
 * @returns {Promise<{ checked: number, completed: number, failed: number }>}
 */
export async function syncGitHubIssueStatuses(options = {}) {
  const logger = options.logger;
  const client = options.client;
  const loadCommitments = options.loadCommitments ?? getOpenCommitmentsWithGithubIssues;
  const fetchIssue = options.fetchIssue ?? getIssue;
  const completeCommitment = options.completeCommitment ?? markCommitmentCompleted;
  const commitments = /** @type {Array<LinkedCommitment>} */ (await loadCommitments());
  let completed = 0;
  let failed = 0;

  for (const commitment of commitments) {
    if (typeof commitment.github_issue_number !== 'number') {
      continue;
    }

    try {
      const issue = await fetchIssue(commitment.github_issue_number, { logger });
      if (issue.state === 'closed') {
        const updated = await completeCommitment(commitment.id);
      
        if (updated) {
          completed += 1;
      
          if (client && commitment.message_ts) {
            try {
              await client.chat.update({
                channel: commitment.channel_id,
                ts: commitment.message_ts,
                text: '✅ Commitment Completed',
                blocks: buildCommitmentCompletedCard(commitment.text, {
                  issueNumber: issue.number,
                  issueUrl: issue.url,
                }),
              });
            } catch (slackError) {
              logger?.error?.(
                `Failed to update Slack message for commitment ${commitment.id}: ${slackError}`,
              );
            }
          }
      
          logger?.info?.(
            `Marked commitment completed from GitHub issue state: commitment_id=${commitment.id}, issue_number=${issue.number}`,
          );
        } else {
          failed += 1;
          logger?.error?.(
            `Failed to mark commitment completed: commitment_id=${commitment.id}, no row updated`,
          );
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
    `GitHub issue status sync finished: checked=${commitments.length}, completed=${completed}, failed=${failed}`,
  );
  return { checked: commitments.length, completed, failed };
}

/**
 * Start polling GitHub issue status.
 * @param {{
 *   logger?: SyncLogger,
 *   client?: import('@slack/web-api').WebClient,
 *   intervalMs?: number,
 *   setIntervalImpl?: typeof setInterval,
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

  logger?.info?.(`Starting GitHub issue status sync service: interval_ms=${intervalMs}`);
  const runSync = () => {
    syncGitHubIssueStatuses({
      logger,
      client,
    }).catch((error) => {
      logger?.error?.(`GitHub issue status sync failed: ${error}`);
    });
  };

  runSync();
  return setIntervalImpl(runSync, intervalMs);
}
