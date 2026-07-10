import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import {
  extractContextSnapshotSummary,
  getEligibleSyncCommitments,
  startSyncService,
  syncGitHubIssueStatuses,
} from '../../services/sync-service.js';

const openCommitment = {
  id: 1,
  text: 'Ill handle the API migration this week.',
  user_id: 'U024REALUSER',
  channel_id: 'C123',
  thread_ts: '171.111',
  message_ts: '171.100',
  status: 'open',
  github_issue_number: 21,
  github_issue_url: 'https://github.com/owner/repo/issues/21',
};

function issueBodyWithSummary(summary) {
  return ['# Context Snapshot', '', '## Summary', summary, '', '## Requirements', 'Not specified'].join('\n');
}

describe('sync-service', () => {
  it('extracts the Context Snapshot summary from a GitHub issue body', () => {
    assert.strictEqual(extractContextSnapshotSummary(issueBodyWithSummary('API migration')), 'API migration');
  });

  it('posts loop closure in the original thread and marks completed when GitHub issue is closed', async () => {
    const completedIds = [];
    const slackCalls = [];

    const client = {
      chat: {
        postMessage: async (payload) => {
          slackCalls.push(payload);
        },
      },
    };

    const result = await syncGitHubIssueStatuses({
      client,
      loadCommitments: async () => [openCommitment],
      fetchIssue: async () => ({
        number: 21,
        state: 'closed',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'Fallback title',
        body: issueBodyWithSummary('API migration'),
      }),
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
    });

    assert.deepStrictEqual(completedIds, [1]);
    assert.deepStrictEqual(slackCalls, [
      {
        channel: 'C123',
        thread_ts: '171.111',
        text: '✅ Issue #21 has been closed.\n\nThe API migration commitment made by <@U024REALUSER> is complete.\n\nLoop closed.',
      },
    ]);
    assert.deepStrictEqual(result, {
      checked: 1,
      closed: 1,
      posted: 1,
      completed: 1,
      failed: 0,
    });
  });

  it('does nothing when GitHub issue remains open', async () => {
    const completeCommitment = mock.fn(async () => true);
    const client = {
      chat: {
        postMessage: mock.fn(async () => {}),
      },
    };

    const result = await syncGitHubIssueStatuses({
      client,
      loadCommitments: async () => [openCommitment],
      fetchIssue: async () => ({
        number: 21,
        state: 'open',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'API migration',
        body: issueBodyWithSummary('API migration'),
      }),
      completeCommitment,
    });

    assert.strictEqual(completeCommitment.mock.callCount(), 0);
    assert.strictEqual(client.chat.postMessage.mock.callCount(), 0);
    assert.deepStrictEqual(result, {
      checked: 1,
      closed: 0,
      posted: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('does not post or complete issues that are already completed locally', async () => {
    const postClosureMessage = mock.fn(async () => {});
    const completeCommitment = mock.fn(async () => true);

    const result = await syncGitHubIssueStatuses({
      client: { chat: { postMessage: async () => {} } },
      loadCommitments: async () => [{ ...openCommitment, status: 'completed' }],
      fetchIssue: async () => ({
        number: 21,
        state: 'closed',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'API migration',
        body: issueBodyWithSummary('API migration'),
      }),
      postClosureMessage,
      completeCommitment,
    });

    assert.strictEqual(postClosureMessage.mock.callCount(), 0);
    assert.strictEqual(completeCommitment.mock.callCount(), 0);
    assert.deepStrictEqual(result, {
      checked: 1,
      closed: 0,
      posted: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('completes GitHub sync without retrying when Slack posting fails', async () => {
    const completeCommitment = mock.fn(async () => true);
    const recordFailure = mock.fn(async () => ({ updated: true, failureCount: 1, quarantined: false }));
    const clearFailure = mock.fn(async () => true);

    const result = await syncGitHubIssueStatuses({
      client: { chat: { postMessage: async () => {} } },
      loadCommitments: async () => [openCommitment],
      fetchIssue: async () => ({
        number: 21,
        state: 'closed',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'API migration',
        body: issueBodyWithSummary('API migration'),
      }),
      postClosureMessage: async () => {
        throw new Error('Slack unavailable');
      },
      completeCommitment,
      recordFailure,
      clearFailure,
      logger: { error: () => {} },
    });

    assert.strictEqual(completeCommitment.mock.callCount(), 1);
    assert.strictEqual(recordFailure.mock.callCount(), 0);
    assert.strictEqual(clearFailure.mock.callCount(), 0);
    assert.deepStrictEqual(result, {
      checked: 1,
      closed: 1,
      posted: 0,
      completed: 1,
      failed: 1,
    });
  });

  it('does not reset GitHub retry state because Slack delivery fails', async () => {
    const commitment = { ...openCommitment };
    const completeCommitment = mock.fn(async () => true);
    const recordFailure = mock.fn(async () => ({ updated: true, failureCount: 1, quarantined: false }));
    const clearFailure = mock.fn(async () => true);

    await syncGitHubIssueStatuses({
      client: { chat: { postMessage: async () => {} } },
      loadCommitments: async () => [commitment],
      fetchIssue: async () => ({
        number: 21,
        state: 'closed',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'API migration',
        body: issueBodyWithSummary('API migration'),
      }),
      postClosureMessage: async () => {
        const error = new Error('team_access_not_granted');
        error.data = { error: 'team_access_not_granted' };
        throw error;
      },
      completeCommitment,
      recordFailure,
      clearFailure,
      logger: { error: () => {} },
    });

    assert.strictEqual(recordFailure.mock.callCount(), 0);
    assert.strictEqual(clearFailure.mock.callCount(), 0);
  });

  it('isolates GitHub failures for one commitment and continues syncing others', async () => {
    const completedIds = [];
    const slackCalls = [];

    const client = {
      chat: {
        postMessage: async (payload) => {
          slackCalls.push(payload);
        },
      },
    };

    const result = await syncGitHubIssueStatuses({
      client,
      loadCommitments: async () => [
        openCommitment,
        {
          ...openCommitment,
          id: 2,
          text: "I'll finish API docs",
          thread_ts: '171.222',
          github_issue_number: 22,
          github_issue_url: 'https://github.com/owner/repo/issues/22',
        },
      ],
      fetchIssue: async (issueNumber) => {
        if (issueNumber === 21) {
          throw new Error('GitHub unavailable');
        }

        return {
          number: 22,
          state: 'closed',
          url: 'https://github.com/owner/repo/issues/22',
          title: 'API docs',
          body: issueBodyWithSummary('API docs'),
        };
      },
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
      logger: { error: () => {} },
    });

    assert.deepStrictEqual(completedIds, [2]);
    assert.strictEqual(slackCalls.length, 1);
    assert.strictEqual(slackCalls[0].thread_ts, '171.222');
    assert.deepStrictEqual(result, {
      checked: 2,
      closed: 1,
      posted: 1,
      completed: 1,
      failed: 1,
    });
  });

  it('filters sync eligibility before GitHub polling', async () => {
    const commitments = [
      openCommitment,
      { ...openCommitment, id: 2, github_issue_number: 0, github_issue_url: 'https://github.com/owner/repo/issues/0' },
      { ...openCommitment, id: 3, github_issue_number: Number.NaN },
      { ...openCommitment, id: 4, github_issue_number: 22, github_issue_url: '' },
      {
        ...openCommitment,
        id: 5,
        user_id: 'U123',
        github_issue_number: 23,
        github_issue_url: 'https://github.com/owner/repo/issues/23',
      },
      {
        ...openCommitment,
        id: 6,
        text: `fixture-filter-${Date.now()}`,
        github_issue_number: 24,
        github_issue_url: 'https://github.com/owner/repo/issues/24',
      },
      { ...openCommitment, id: 7, status: 'completed' },
      { ...openCommitment, id: 8, github_sync_quarantined_at: '2026-07-10 00:00:00' },
      { ...openCommitment, id: 9 },
    ];

    const eligible = getEligibleSyncCommitments(commitments, { logger: { warn: () => {} } });

    assert.deepStrictEqual(
      eligible.map((commitment) => commitment.id),
      [1],
    );
  });

  it('does not call GitHub for invalid issue numbers, missing URLs, fixtures, or duplicates', async () => {
    const fetchIssue = mock.fn(async () => ({
      number: 21,
      state: 'open',
      url: 'https://github.com/owner/repo/issues/21',
      title: 'API migration',
      body: '',
    }));

    const result = await syncGitHubIssueStatuses({
      loadCommitments: async () => [
        { ...openCommitment, id: 1 },
        {
          ...openCommitment,
          id: 2,
          github_issue_number: -1,
          github_issue_url: 'https://github.com/owner/repo/issues/-1',
        },
        { ...openCommitment, id: 3, github_issue_number: null },
        { ...openCommitment, id: 4, github_issue_number: 22, github_issue_url: null },
        {
          ...openCommitment,
          id: 5,
          user_id: 'U999',
          github_issue_number: 23,
          github_issue_url: 'https://github.com/owner/repo/issues/23',
        },
        { ...openCommitment, id: 6 },
      ],
      fetchIssue,
      logger: { warn: () => {}, debug: () => {} },
    });

    assert.strictEqual(fetchIssue.mock.callCount(), 1);
    assert.strictEqual(fetchIssue.mock.calls[0].arguments[0], 21);
    assert.deepStrictEqual(result, {
      checked: 6,
      closed: 0,
      posted: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('does not iterate fixtures or quarantined commitments when the loader is already eligible', async () => {
    const fetchIssue = mock.fn(async () => ({
      number: 21,
      state: 'open',
      url: 'https://github.com/owner/repo/issues/21',
      title: 'API migration',
      body: '',
    }));

    const result = await syncGitHubIssueStatuses({
      loadCommitments: async () => [openCommitment],
      fetchIssue,
      logger: { warn: () => {}, debug: () => {} },
    });

    assert.strictEqual(fetchIssue.mock.callCount(), 1);
    assert.deepStrictEqual(result, {
      checked: 1,
      closed: 0,
      posted: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('retries deleted GitHub issues across polling cycles before quarantine', async () => {
    const commitment = { ...openCommitment };
    const calls = [];
    const recordFailure = mock.fn(async (id, { reason, maxFailures }) => {
      calls.push({ id, reason, maxFailures });
      commitment.github_sync_failure_count = (commitment.github_sync_failure_count ?? 0) + 1;
      const quarantined = commitment.github_sync_failure_count >= maxFailures;
      if (quarantined) {
        commitment.github_sync_quarantined_at = '2026-07-10 00:00:00';
      }
      return { updated: true, failureCount: commitment.github_sync_failure_count, quarantined };
    });
    const fetchIssue = mock.fn(async () => {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    });

    await syncGitHubIssueStatuses({
      loadCommitments: async () => [commitment],
      fetchIssue,
      recordFailure,
      maxSyncFailures: 2,
      logger: { warn: () => {}, debug: () => {} },
    });
    await syncGitHubIssueStatuses({
      loadCommitments: async () => [commitment],
      fetchIssue,
      recordFailure,
      maxSyncFailures: 2,
      logger: { warn: () => {}, debug: () => {} },
    });
    await syncGitHubIssueStatuses({
      loadCommitments: async () => [commitment],
      fetchIssue,
      recordFailure,
      maxSyncFailures: 2,
      logger: { warn: () => {}, debug: () => {} },
    });

    assert.strictEqual(fetchIssue.mock.callCount(), 2);
    assert.deepStrictEqual(calls, [
      { id: 1, reason: 'github_status_404', maxFailures: 2 },
      { id: 1, reason: 'github_status_404', maxFailures: 2 },
    ]);
  });

  it('retries temporary GitHub failures and clears retry state after recovery', async () => {
    const commitment = { ...openCommitment };
    const clearFailure = mock.fn(async (id) => {
      commitment.github_sync_failure_count = 0;
      return id === commitment.id;
    });
    const recordFailure = mock.fn(async () => {
      commitment.github_sync_failure_count = 1;
      return { updated: true, failureCount: 1, quarantined: false };
    });
    let attempts = 0;
    const fetchIssue = mock.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('network timeout');
      }

      return {
        number: 21,
        state: 'open',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'API migration',
        body: '',
      };
    });

    await syncGitHubIssueStatuses({
      loadCommitments: async () => [commitment],
      fetchIssue,
      recordFailure,
      clearFailure,
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });
    await syncGitHubIssueStatuses({
      loadCommitments: async () => [commitment],
      fetchIssue,
      recordFailure,
      clearFailure,
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });

    assert.strictEqual(fetchIssue.mock.callCount(), 2);
    assert.strictEqual(recordFailure.mock.callCount(), 1);
    assert.strictEqual(clearFailure.mock.callCount(), 1);
    assert.strictEqual(commitment.github_sync_failure_count, 0);
  });

  it('continues syncing valid commitments while another record is quarantined after the retry limit', async () => {
    const quarantined = { ...openCommitment, id: 1 };
    const valid = {
      ...openCommitment,
      id: 2,
      text: "I'll finish API docs",
      thread_ts: '171.222',
      github_issue_number: 22,
      github_issue_url: 'https://github.com/owner/repo/issues/22',
    };
    const completedIds = [];

    const result = await syncGitHubIssueStatuses({
      client: { chat: { postMessage: async () => {} } },
      loadCommitments: async () => [quarantined, valid],
      fetchIssue: async (issueNumber) => {
        if (issueNumber === 21) {
          const error = new Error('Bad gateway');
          error.status = 502;
          throw error;
        }

        return {
          number: 22,
          state: 'closed',
          url: 'https://github.com/owner/repo/issues/22',
          title: 'API docs',
          body: issueBodyWithSummary('API docs'),
        };
      },
      recordFailure: async () => ({ updated: true, failureCount: 3, quarantined: true }),
      postClosureMessage: async () => {},
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
      maxSyncFailures: 3,
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });

    assert.deepStrictEqual(completedIds, [2]);
    assert.deepStrictEqual(result, {
      checked: 2,
      closed: 1,
      posted: 1,
      completed: 1,
      failed: 1,
    });
  });

  it('posts only one completion notification for a completed commitment', async () => {
    const commitment = { ...openCommitment };
    const postClosureMessage = mock.fn(async () => {});
    const completeCommitment = mock.fn(async (id) => {
      if (id !== commitment.id || commitment.status === 'completed') {
        return false;
      }

      commitment.status = 'completed';
      return true;
    });

    const options = {
      client: { chat: { postMessage: async () => {} } },
      loadCommitments: async () => [commitment],
      fetchIssue: async () => ({
        number: 21,
        state: 'closed',
        url: 'https://github.com/owner/repo/issues/21',
        title: 'API migration',
        body: issueBodyWithSummary('API migration'),
      }),
      postClosureMessage,
      completeCommitment,
      logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    };

    await syncGitHubIssueStatuses(options);
    await syncGitHubIssueStatuses(options);

    assert.strictEqual(completeCommitment.mock.callCount(), 1);
    assert.strictEqual(postClosureMessage.mock.callCount(), 1);
  });

  it('starts polling with the provided interval', () => {
    const setIntervalImpl = mock.fn(() => ({ timer: true }));

    const timer = startSyncService({
      intervalMs: 12345,
      logger: {
        info: () => {},
        error: () => {},
      },
      client: {
        chat: {
          postMessage: async () => {},
        },
      },
      setIntervalImpl,
    });

    assert.deepStrictEqual(timer, { timer: true });
    assert.strictEqual(setIntervalImpl.mock.callCount(), 1);
    assert.strictEqual(setIntervalImpl.mock.calls[0].arguments[1], 12345);
  });

  it('skips overlapping sync runs while a previous run is still running', async () => {
    const setIntervalImpl = mock.fn(() => ({ timer: true }));
    const warnings = [];
    let finishSync;
    const syncOnce = mock.fn(
      () =>
        new Promise((resolve) => {
          finishSync = resolve;
        }),
    );

    startSyncService({
      intervalMs: 12345,
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
        error: () => {},
      },
      client: { chat: { postMessage: async () => {} } },
      setIntervalImpl,
      syncOnce,
    });

    const runSync = setIntervalImpl.mock.calls[0].arguments[0];
    runSync();

    assert.strictEqual(syncOnce.mock.callCount(), 1);
    assert.deepStrictEqual(warnings, ['Skipping GitHub issue status sync because a previous sync is still running']);

    finishSync();
    await new Promise((resolve) => setImmediate(resolve));
    runSync();

    assert.strictEqual(syncOnce.mock.callCount(), 2);
  });
});
