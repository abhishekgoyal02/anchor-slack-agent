import assert from 'node:assert';
import { describe, it } from 'node:test';

import { searchCommitments } from '../../services/commitment-search-service.js';

describe('commitment-search-service', () => {
  it('searches through the injected store and returns DTOs', async () => {
    const calls = [];
    const results = await searchCommitments(
      { query: ' authentication ' },
      {
        store: {
          findCommitmentsByText: async (query) => {
            calls.push(query);
            return [
              {
                id: 12,
                text: 'Authentication API',
                user_id: 'U123',
                channel_id: 'C123',
                thread_ts: 'T123',
                message_ts: 'M123',
                status: 'open',
                created_at: '2026-07-01 00:00:00',
                github_issue_number: 18,
                github_issue_url: 'https://github.com/example/repo/issues/18',
                completed_at: null,
              },
            ];
          },
        },
      },
    );

    assert.deepStrictEqual(calls, ['authentication']);
    assert.deepStrictEqual(results, [
      {
        id: 12,
        title: 'Authentication API',
        status: 'Open',
        assignee: 'U123',
        githubIssue: 18,
        createdAt: '2026-07-01 00:00:00',
        updatedAt: '2026-07-01 00:00:00',
        thread: 'T123',
        channel: 'C123',
      },
    ]);
  });

  it('returns empty results without querying storage for blank input', async () => {
    let called = false;
    const results = await searchCommitments(
      { query: '   ' },
      {
        store: {
          findCommitmentsByText: async () => {
            called = true;
            return [];
          },
        },
      },
    );

    assert.deepStrictEqual(results, []);
    assert.strictEqual(called, false);
  });

  it('returns empty results for an empty database result', async () => {
    const results = await searchCommitments(
      { query: 'missing' },
      {
        store: {
          findCommitmentsByText: async () => [],
        },
      },
    );

    assert.deepStrictEqual(results, []);
  });
});
