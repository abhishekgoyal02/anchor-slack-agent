import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import { startSyncService, syncGitHubIssueStatuses } from '../../services/sync-service.js';

describe('sync-service', () => {
  it('marks linked commitments completed when GitHub issue is closed', async () => {
    const completedIds = [];

    const result = await syncGitHubIssueStatuses({
      loadCommitments: async () => [{ id: 1, github_issue_number: 12 }],
      fetchIssue: async () => ({ number: 12, state: 'closed', url: 'https://github.com/owner/repo/issues/12' }),
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
    });

    assert.deepStrictEqual(completedIds, [1]);
    assert.deepStrictEqual(result, { checked: 1, completed: 1, failed: 0 });
  });

  it('does nothing when GitHub issue remains open', async () => {
    const completeCommitment = mock.fn(async () => true);

    const result = await syncGitHubIssueStatuses({
      loadCommitments: async () => [{ id: 1, github_issue_number: 12 }],
      fetchIssue: async () => ({ number: 12, state: 'open', url: 'https://github.com/owner/repo/issues/12' }),
      completeCommitment,
    });

    assert.strictEqual(completeCommitment.mock.callCount(), 0);
    assert.deepStrictEqual(result, { checked: 1, completed: 0, failed: 0 });
  });

  it('isolates failures for one commitment and continues syncing others', async () => {
    const completedIds = [];

    const result = await syncGitHubIssueStatuses({
      loadCommitments: async () => [
        { id: 1, github_issue_number: 12 },
        { id: 2, github_issue_number: 13 },
      ],
      fetchIssue: async (issueNumber) => {
        if (issueNumber === 12) {
          throw new Error('GitHub unavailable');
        }

        return { number: 13, state: 'closed', url: 'https://github.com/owner/repo/issues/13' };
      },
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
    });

    assert.deepStrictEqual(completedIds, [2]);
    assert.deepStrictEqual(result, { checked: 2, completed: 1, failed: 1 });
  });

  it('starts polling with the provided interval', () => {
    const setIntervalImpl = mock.fn(() => ({ timer: true }));
    const timer = startSyncService({
      intervalMs: 12345,
      logger: {
        info: () => {},
        error: () => {},
      },
      setIntervalImpl,
    });

    assert.deepStrictEqual(timer, { timer: true });
    assert.strictEqual(setIntervalImpl.mock.callCount(), 1);
    assert.strictEqual(setIntervalImpl.mock.calls[0].arguments[1], 12345);
  });
});
