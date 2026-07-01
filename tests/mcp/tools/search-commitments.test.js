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
      ],
    });
    const results = await tool.execute({ query: 'authentication' });

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
