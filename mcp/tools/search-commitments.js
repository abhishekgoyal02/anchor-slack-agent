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
      title: 'Authentication API',
      status: '🟡 Open',
      githubIssue: 'GitHub Issue #18',
      created: 'Today',
      assigneeName: 'Abhishek Goyal',
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
