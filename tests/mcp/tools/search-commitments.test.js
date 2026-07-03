import assert from 'node:assert';
import { describe, it } from 'node:test';

import { createSearchCommitmentsTool, inputSchema, metadata } from '../../../mcp/tools/search-commitments.js';

describe('search_commitments tool', () => {
  it('exports metadata', () => {
    assert.strictEqual(metadata.name, 'search_commitments');
    assert.match(metadata.description, /Search Anchor commitments/);
    assert.strictEqual(metadata.version, '1.0.0');
    assert.strictEqual(metadata.category, 'commitments');
    assert.deepStrictEqual(metadata.exampleInput, { query: 'authentication' });
  });

  it('validates input', () => {
    assert.deepStrictEqual(inputSchema.parse({ query: 'authentication' }), {
      query: 'authentication',
    });
    assert.throws(() => inputSchema.parse({ query: '' }));
  });

  it('returns formatted commitment results', async () => {
    const tool = createSearchCommitmentsTool({
      commitmentSearchService: async () => [
        {
          title: 'Authentication API',
          status: 'Open',
          githubIssue: '18',
          createdAt: '2026-07-01 07:12:35',
          updatedAt: '2026-07-01 07:12:35',
          assignee: '<@U123>',
        },
      ],
    });
    const results = await tool.execute({ query: 'authentication' });

    assert.deepStrictEqual(results, [
      {
        title: 'Authentication API',
        status: 'Open',
        githubIssue: '18',
        createdAt: '2026-07-01 07:12:35',
        updatedAt: '2026-07-01 07:12:35',
        assignee: '<@U123>',
      },
    ]);
  });

  it('sorts results by status priority and newest-first within status', async () => {
    const tool = createSearchCommitmentsTool({
      commitmentSearchService: async () => [
        { title: 'Archived work', status: 'Archived', githubIssue: 'Not linked', createdAt: '2026-07-01 00:00:00' },
        { title: 'Completed older', status: 'Completed', githubIssue: '11', createdAt: '2026-06-28 00:00:00' },
        { title: 'Open older', status: 'Open', githubIssue: '13', createdAt: '2026-06-30 00:00:00' },
        { title: 'In progress', status: 'In Progress', githubIssue: '12', createdAt: '2026-07-01 00:00:00' },
        { title: 'Open newest', status: 'Open', githubIssue: 'Not linked', createdAt: '2026-07-01 00:00:00' },
      ],
    });

    const results = await tool.execute({ query: 'api' });

    assert.deepStrictEqual(
      results.map((item) => item.title),
      ['Open newest', 'Open older', 'In progress', 'Completed older', 'Archived work'],
    );
  });

  it('returns empty results', async () => {
    const tool = createSearchCommitmentsTool({
      commitmentSearchService: async () => [],
    });
    const results = await tool.execute({ query: 'missing' });

    assert.deepStrictEqual(results, []);
  });

  it('uses the injected commitment search service', async () => {
    const calls = [];
    const tool = createSearchCommitmentsTool({
      commitmentSearchService: async (input) => {
        calls.push(input);
        return [];
      },
    });

    await tool.execute({ query: 'authentication' });

    assert.deepStrictEqual(calls, [{ query: 'authentication' }]);
  });
});
