import { z } from 'zod';

import { searchCommitments } from '../../services/commitment-search-service.js';

export const metadata = {
  name: 'search_commitments',
  description: 'Search Anchor commitments.',
  version: '1.0.0',
  category: 'commitments',
  exampleInput: {
    query: 'authentication',
  },
  exampleOutput: [
    {
      id: 12,
      title: 'Authentication API',
      status: 'Open',
      assignee: 'U123',
      githubIssue: 18,
      createdAt: '2026-07-01 10:00:00',
      updatedAt: '2026-07-01 10:00:00',
      thread: '1751344200.000000',
      channel: 'C123',
    },
  ],
};

export const inputSchema = z.object({
  query: z.string().trim().min(1),
});

/**
 * Create the search_commitments MCP tool.
 * @param {{ commitmentSearchService?: typeof searchCommitments }} [deps]
 * @returns {import('../server.js').McpTool}
 */
export function createSearchCommitmentsTool(deps = {}) {
  const commitmentSearchService = deps.commitmentSearchService ?? searchCommitments;

  return {
    metadata,
    inputSchema,
    execute: async (input) => commitmentSearchService(input),
  };
}
