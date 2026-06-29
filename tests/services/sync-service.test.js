import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import { startSyncService, syncGitHubIssueStatuses } from '../../services/sync-service.js';

describe('sync-service', () => {
  it('marks linked commitments completed and updates Slack when GitHub issue is closed', async () => {
    const completedIds = [];
    const slackCalls = [];

    const client = {
      chat: {
        update: async (payload) => {
          slackCalls.push(payload);
        },
      },
    };

    const result = await syncGitHubIssueStatuses({
      client,
      loadCommitments: async () => [
        {
          id: 1,
          text: "I'll finish API docs",
          channel_id: 'C123',
          thread_ts: '171.111',
          message_ts: '171.111',
          github_issue_number: 12,
          github_issue_url: 'https://github.com/owner/repo/issues/12',
        },
      ],
      fetchIssue: async () => ({
        number: 12,
        state: 'closed',
        url: 'https://github.com/owner/repo/issues/12',
      }),
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
    });

    assert.deepStrictEqual(completedIds, [1]);

    assert.strictEqual(slackCalls.length, 1);

    assert.strictEqual(slackCalls[0].channel, 'C123');
    assert.strictEqual(slackCalls[0].ts, '171.111');
    assert.strictEqual(slackCalls[0].text, '✅ Commitment Completed');
    assert.ok(Array.isArray(slackCalls[0].blocks));
    assert.strictEqual(slackCalls[0].blocks.length, 1);
    assert.strictEqual(slackCalls[0].blocks[0].type, 'section');
    assert.strictEqual(slackCalls[0].blocks[0].text.type, 'mrkdwn');
    assert.match(slackCalls[0].blocks[0].text.text, /Commitment Completed/);
    assert.match(slackCalls[0].blocks[0].text.text, /I'll finish API docs/);
    assert.match(slackCalls[0].blocks[0].text.text, /#12/);

    assert.deepStrictEqual(result, {
      checked: 1,
      completed: 1,
      failed: 0,
    });
  });

  it('does nothing when GitHub issue remains open', async () => {
    const completeCommitment = mock.fn(async () => true);

    const client = {
      chat: {
        update: mock.fn(async () => {}),
      },
    };

    const result = await syncGitHubIssueStatuses({
      client,
      loadCommitments: async () => [
        {
          id: 1,
          text: 'Test',
          channel_id: 'C123',
          thread_ts: '171.111',
          message_ts: '171.111',
          github_issue_number: 12,
          github_issue_url: '',
        },
      ],
      fetchIssue: async () => ({
        number: 12,
        state: 'open',
        url: 'https://github.com/owner/repo/issues/12',
      }),
      completeCommitment,
    });

    assert.strictEqual(completeCommitment.mock.callCount(), 0);
    assert.strictEqual(client.chat.update.mock.callCount(), 0);

    assert.deepStrictEqual(result, {
      checked: 1,
      completed: 0,
      failed: 0,
    });
  });

  it('isolates failures for one commitment and continues syncing others', async () => {
    const completedIds = [];
    const slackCalls = [];

    const client = {
      chat: {
        update: async (payload) => {
          slackCalls.push(payload);
        },
      },
    };

    const result = await syncGitHubIssueStatuses({
      client,
      loadCommitments: async () => [
        {
          id: 1,
          text: 'Fail',
          channel_id: 'C123',
          thread_ts: '171.111',
          message_ts: '171.111',
          github_issue_number: 12,
          github_issue_url: '',
        },
        {
          id: 2,
          text: 'Success',
          channel_id: 'C123',
          thread_ts: '171.222',
          message_ts: '171.222',
          github_issue_number: 13,
          github_issue_url: '',
        },
      ],
      fetchIssue: async (issueNumber) => {
        if (issueNumber === 12) {
          throw new Error('GitHub unavailable');
        }

        return {
          number: 13,
          state: 'closed',
          url: 'https://github.com/owner/repo/issues/13',
        };
      },
      completeCommitment: async (id) => {
        completedIds.push(id);
        return true;
      },
    });

    assert.deepStrictEqual(completedIds, [2]);
    assert.strictEqual(slackCalls.length, 1);
    assert.strictEqual(slackCalls[0].ts, '171.222');

    assert.deepStrictEqual(result, {
      checked: 2,
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
          update: async () => {},
        },
      },
      setIntervalImpl,
    });

    assert.deepStrictEqual(timer, { timer: true });

    assert.strictEqual(setIntervalImpl.mock.callCount(), 1);

    assert.strictEqual(setIntervalImpl.mock.calls[0].arguments[1], 12345);
  });
});
