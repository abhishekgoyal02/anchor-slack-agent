import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import {
  extractContextSnapshotSummary,
  startSyncService,
  syncGitHubIssueStatuses,
} from '../../services/sync-service.js';

const openCommitment = {
  id: 1,
  text: 'Ill handle the API migration this week.',
  user_id: 'U123',
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
        text: '✅ Issue #21 has been closed.\n\nThe API migration commitment made by <@U123> is complete.\n\nLoop closed.',
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

  it('does not mark completed when Slack posting fails', async () => {
    const completeCommitment = mock.fn(async () => true);

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
      logger: { error: () => {} },
    });

    assert.strictEqual(completeCommitment.mock.callCount(), 0);
    assert.deepStrictEqual(result, {
      checked: 1,
      closed: 1,
      posted: 0,
      completed: 0,
      failed: 1,
    });
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
