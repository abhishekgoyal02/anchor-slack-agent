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
    user_id: 'workspace-user',
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
                user_id: 'workspace-user',
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
    assert.strictEqual(results[0].assignee, 'workspace-user');
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
            buildRow({ id: 1, text: 'Real auth work', user_id: 'workspace-user' }),
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
            buildRow({ id: 3, text: "I'll migrate authentication to OAuth 2.0", user_id: 'workspace-user' }),
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
            buildRow({ id: 6, text: "I'll finish the commitment review by Monday", user_id: 'workspace-user' }),
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
            buildRow({ id: 1, text: "I'll provide API keys by tomorrow", user_id: 'workspace-user' }),
            buildRow({ id: 2, text: "I'll complete API setup by Friday", user_id: 'workspace-user' }),
            buildRow({ id: 3, text: "I'll finish the login API by Friday", user_id: 'workspace-user' }),
          ],
        },
      },
    );

    assert.strictEqual(results.length, 3);
  });

  it('normalizes ownership queries with synonyms and filler words without crossing into login', async () => {
    const results = await searchCommitments(
      { query: 'Who owns OAuth?' },
      {
        store: {
          findCommitmentsByText: async () => {
            throw new Error('should use getAllCommitments when available');
          },
          getAllCommitments: async () => [
            buildRow({ id: 1, text: "I'll migrate authentication to OAuth 2.0 this weekend" }),
            buildRow({ id: 2, text: "I'll fix the login flow by Friday" }),
            buildRow({ id: 3, text: 'Search fixture auth fixture-filter-1783587905461' }),
            buildRow({ id: 4, text: 'Document API usage' }),
          ],
        },
      },
    );

    assert.deepStrictEqual(
      results.map((result) => result.title),
      ["I'll migrate authentication to OAuth 2.0 this weekend"],
    );
  });

  it('keeps authentication, login, and API topic searches separate', async () => {
    const store = {
      findCommitmentsByText: async () => {
        throw new Error('should use getAllCommitments when available');
      },
      getAllCommitments: async () => [
        buildRow({ id: 1, text: 'Fix Google Authentication before Friday' }),
        buildRow({ id: 2, text: 'OAuth migration' }),
        buildRow({ id: 3, text: 'Finish the login API by Friday' }),
        buildRow({ id: 4, text: 'Document public API usage' }),
        buildRow({ id: 5, text: 'Update onboarding documentation' }),
      ],
    };

    const authenticationResults = await searchCommitments({ query: 'Search authentication' }, { store });
    const loginResults = await searchCommitments({ query: 'Search login' }, { store });
    const apiResults = await searchCommitments({ query: 'Search API' }, { store });
    const documentationResults = await searchCommitments({ query: 'Search documentation' }, { store });

    assert.deepStrictEqual(
      authenticationResults.map((result) => result.title),
      ['Fix Google Authentication before Friday', 'OAuth migration'],
    );
    assert.deepStrictEqual(
      loginResults.map((result) => result.title),
      ['Finish the login API by Friday'],
    );
    assert.deepStrictEqual(
      apiResults.map((result) => result.title),
      ['Finish the login API by Friday', 'Document public API usage'],
    );
    assert.deepStrictEqual(
      documentationResults.map((result) => result.title),
      ['Update onboarding documentation'],
    );
  });

  it('does not let ownership filler words broaden topic matches', async () => {
    const store = {
      findCommitmentsByText: async () => {
        throw new Error('should use getAllCommitments when available');
      },
      getAllCommitments: async () => [
        buildRow({ id: 1, text: 'Build API rate limits' }),
        buildRow({ id: 2, text: 'Finish frontend work' }),
        buildRow({ id: 3, text: 'Write generic work notes' }),
      ],
    };

    const apiWorkResults = await searchCommitments({ query: "Who's doing API work?" }, { store });
    const ownsThisResults = await searchCommitments({ query: 'Who owns this?' }, { store });

    assert.deepStrictEqual(
      apiWorkResults.map((result) => result.title),
      ['Build API rate limits'],
    );
    assert.deepStrictEqual(ownsThisResults, []);
  });

  it('supports open and completed status queries from live commitments', async () => {
    const store = {
      findCommitmentsByText: async () => [],
      getAllCommitments: async () => [
        buildRow({ id: 1, text: 'Open API work', status: 'open' }),
        buildRow({ id: 4, text: 'In progress backend work', status: 'in_progress' }),
        buildRow({ id: 5, text: 'Blocked deployment work', status: 'blocked' }),
        buildRow({ id: 2, text: 'Completed OAuth migration', status: 'completed' }),
        buildRow({ id: 3, text: 'Test commitment 1783587927742', user_id: 'U123', status: 'open' }),
      ],
    };

    const openResults = await searchCommitments({ query: 'Show me open commitments please' }, { store });
    const completedResults = await searchCommitments({ query: 'List completed commitments' }, { store });

    assert.deepStrictEqual(
      openResults.map((result) => result.title),
      ['Open API work', 'In progress backend work', 'Blocked deployment work'],
    );
    assert.deepStrictEqual(
      completedResults.map((result) => result.title),
      ['Completed OAuth migration'],
    );
  });

  it('returns every live unfinished commitment for open commitment queries without topic filtering', async () => {
    const store = {
      findCommitmentsByText: async () => [],
      getAllCommitments: async () => [
        buildRow({ id: 1, text: 'API keys follow-up', status: 'open' }),
        buildRow({ id: 2, text: 'Login redirect fix', status: 'open' }),
        buildRow({ id: 3, text: 'Documentation update', status: 'in_progress' }),
        buildRow({ id: 4, text: 'Deployment checklist', status: 'blocked' }),
        buildRow({ id: 5, text: 'Frontend polish', status: 'open' }),
        buildRow({ id: 6, text: 'Backend queue cleanup', status: 'open' }),
        buildRow({ id: 7, text: 'Completed auth migration', status: 'completed' }),
        buildRow({ id: 8, text: 'Test commitment 1783587927742', user_id: 'U123', status: 'open' }),
      ],
    };

    const results = await searchCommitments({ query: 'Show Open Commitments' }, { store });

    assert.strictEqual(results.length, 6);
    assert.deepStrictEqual(
      results.map((result) => result.title),
      [
        'API keys follow-up',
        'Login redirect fix',
        'Documentation update',
        'Deployment checklist',
        'Frontend polish',
        'Backend queue cleanup',
      ],
    );
  });

  it('supports overdue and today status queries', async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const store = {
      findCommitmentsByText: async () => [],
      getAllCommitments: async () => [
        buildRow({ id: 1, text: 'Overdue deployment checklist', due_date: `${yesterday} 00:00:00` }),
        buildRow({ id: 2, text: 'Completed overdue OAuth work', status: 'completed', due_date: `${yesterday} 00:00:00` }),
        buildRow({ id: 3, text: 'Today API review', created_at: `${today} 09:00:00` }),
      ],
    };

    const overdueResults = await searchCommitments({ query: 'Show overdue work' }, { store });
    const todayResults = await searchCommitments({ query: 'Show todays commitments' }, { store });

    assert.deepStrictEqual(
      overdueResults.map((result) => result.title),
      ['Overdue deployment checklist'],
    );
    assert.deepStrictEqual(
      todayResults.map((result) => result.title),
      ['Today API review'],
    );
  });

  it('derives release blockers from unfinished relevant commitments only', async () => {
    const results = await searchCommitments(
      { query: 'What is blocking deployment?' },
      {
        store: {
          findCommitmentsByText: async () => [],
          getAllCommitments: async () => [
            buildRow({ id: 1, text: 'Production deployment checklist', status: 'open' }),
            buildRow({ id: 2, text: 'API migration', status: 'in_progress' }),
            buildRow({ id: 3, text: 'Completed login migration', status: 'completed' }),
            buildRow({ id: 4, text: 'Write office notes', status: 'open' }),
          ],
        },
      },
    );

    assert.deepStrictEqual(
      results.map((result) => result.title),
      ['Production deployment checklist', 'API migration'],
    );
  });
});

describe('isTestFixture', () => {
  it('flags U123 as a test user', () => {
    assert.strictEqual(isTestFixture(buildRow({ user_id: 'U123' })), true);
  });

  it('flags U999 as a test user', () => {
    assert.strictEqual(isTestFixture(buildRow({ user_id: 'U999' })), true);
  });

  it('does not flag non-test workspace users', () => {
    assert.strictEqual(isTestFixture(buildRow({ user_id: 'workspace-user' })), false);
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
