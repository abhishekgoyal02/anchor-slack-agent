import assert from 'node:assert';
import { describe, it } from 'node:test';

import { searchCommitments } from '../../services/commitment-search-service.js';
import { isTestFixture } from '../../services/commitment-search-service.js';

/**
 * Helper to build a minimal storage Commitment row.
 * @param {Partial<import('../../storage/commitment-store.js').Commitment>} overrides
 * @returns {import('../../storage/commitment-store.js').Commitment}
 */
function buildRow(overrides = {}) {
  return {
    id: 1,
    text: "I'll finish the API by Friday",
    user_id: 'U0BBN0MUXS7',
    channel_id: 'C123',
    thread_ts: 'T123',
    message_ts: 'M123',
    status: 'open',
    created_at: '2026-07-01 00:00:00',
    github_issue_number: null,
    github_issue_url: null,
    completed_at: null,
    ...overrides,
  };
}

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
                user_id: 'U0BBN0MUXS7',
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
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'Authentication API');
    assert.strictEqual(results[0].status, 'Open');
    assert.strictEqual(results[0].githubIssue, '18');
    assert.strictEqual(results[0].createdAt, '2026-07-01 00:00:00');
    assert.strictEqual(results[0].updatedAt, '2026-07-01 00:00:00');
    assert.strictEqual(results[0].assignee, '<@U0BBN0MUXS7>');
  });

  it('omits assignee and GitHub issue when they do not exist', async () => {
    const results = await searchCommitments(
      { query: 'missing owner' },
      {
        store: {
          findCommitmentsByText: async () => [
            {
              id: 99,
              text: 'Review authentication',
              user_id: '',
              channel_id: 'C123',
              thread_ts: 'T123',
              message_ts: 'M123',
              status: 'open',
              created_at: '2026-07-01 00:00:00',
              github_issue_number: null,
              github_issue_url: null,
              completed_at: null,
            },
          ],
        },
      },
    );

    assert.deepStrictEqual(results[0], {
      title: 'Review authentication',
      status: 'Open',
      createdAt: '2026-07-01 00:00:00',
      updatedAt: '2026-07-01 00:00:00',
    });
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

  it('filters out rows from well-known test user IDs', async () => {
    const results = await searchCommitments(
      { query: 'auth' },
      {
        store: {
          findCommitmentsByText: async () => [
            buildRow({ id: 1, text: 'Real auth work', user_id: 'U0BBN0MUXS7' }),
            buildRow({ id: 2, text: 'Customer auth linked work 1783587905429', user_id: 'U999' }),
            buildRow({ id: 3, text: 'Test commitment authentication fixture-filter-1783587905461', user_id: 'U999' }),
            buildRow({ id: 4, text: 'Auth API upgrade', user_id: 'U123' }),
          ],
        },
      },
    );

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'Real auth work');
  });

  it('filters out fixture-filter and open-filter text patterns', async () => {
    const results = await searchCommitments(
      { query: 'auth' },
      {
        store: {
          findCommitmentsByText: async () => [
            buildRow({ id: 1, text: 'Customer authentication cleanup fixture-filter-1783587905461' }),
            buildRow({ id: 2, text: 'Payment gateway owner follow-up open-filter-1783587905501' }),
            buildRow({ id: 3, text: "I'll migrate authentication to OAuth 2.0", user_id: 'U0BBN0MUXS7' }),
          ],
        },
      },
    );

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, "I'll migrate authentication to OAuth 2.0");
  });

  it('filters out rows with test harness numeric suffixes', async () => {
    const results = await searchCommitments(
      { query: 'commitment' },
      {
        store: {
          findCommitmentsByText: async () => [
            buildRow({ id: 1, text: 'Test commitment 1783587927742', user_id: 'U123' }),
            buildRow({ id: 2, text: 'Test GitHub metadata 1783587927780', user_id: 'U123' }),
            buildRow({ id: 3, text: 'Linked commitment 1783587927914', user_id: 'U123' }),
            buildRow({ id: 4, text: 'Completable commitment 1783587927980', user_id: 'U123' }),
            buildRow({ id: 5, text: 'Already completed commitment 1783587928000', user_id: 'U123' }),
            buildRow({ id: 6, text: "I'll finish the commitment review by Monday", user_id: 'U0BBN0MUXS7' }),
          ],
        },
      },
    );

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, "I'll finish the commitment review by Monday");
  });

  it('preserves real commitments with similar keywords', async () => {
    const results = await searchCommitments(
      { query: 'API' },
      {
        store: {
          findCommitmentsByText: async () => [
            buildRow({ id: 1, text: "I'll provide API keys by tomorrow", user_id: 'U0BBN0MUXS7' }),
            buildRow({ id: 2, text: "I'll complete API setup by Friday", user_id: 'U0BBN0MUXS7' }),
            buildRow({ id: 3, text: "I'll finish the login API by Friday", user_id: 'U0BBN0MUXS7' }),
          ],
        },
      },
    );

    assert.strictEqual(results.length, 3);
  });
});

describe('isTestFixture', () => {
  it('flags U123 as a test user', () => {
    assert.strictEqual(isTestFixture(buildRow({ user_id: 'U123' })), true);
  });

  it('flags U999 as a test user', () => {
    assert.strictEqual(isTestFixture(buildRow({ user_id: 'U999' })), true);
  });

  it('does not flag real Slack user IDs', () => {
    assert.strictEqual(isTestFixture(buildRow({ user_id: 'U0BBN0MUXS7' })), false);
  });

  it('flags fixture-filter text', () => {
    assert.strictEqual(
      isTestFixture(buildRow({ text: 'Customer authentication cleanup fixture-filter-1783587905461' })),
      true,
    );
  });

  it('flags open-filter text', () => {
    assert.strictEqual(
      isTestFixture(buildRow({ text: 'Payment gateway owner follow-up open-filter-1783587905501' })),
      true,
    );
  });

  it('does not flag real commitment text', () => {
    assert.strictEqual(
      isTestFixture(buildRow({ text: "I'll migrate authentication to OAuth 2.0 this weekend" })),
      false,
    );
  });

  it('does not flag real commitment text that contains words like "test"', () => {
    assert.strictEqual(
      isTestFixture(buildRow({ text: "I'll write tests for the login flow by Friday" })),
      false,
    );
  });
});
