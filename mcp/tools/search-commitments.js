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
      title: "I'll complete the login API by Friday",
      status: 'Open',
      githubIssue: '18',
      createdAt: '2026-07-01 07:12:35',
      updatedAt: '2026-07-01 07:12:35',
      assignee: '<@U123ABC45>',
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
    execute: async (input) => {
      const results = await commitmentSearchService(input);
      return [...results].sort(compareCommitmentsForUx);
    },
  };
}

const STATUS_PRIORITY = {
  Open: 0,
  'In Progress': 1,
  Completed: 2,
  Archived: 3,
};

/**
 * @param {{ status?: string, createdAt?: string }} left
 * @param {{ status?: string, createdAt?: string }} right
 * @returns {number}
 */
function compareCommitmentsForUx(left, right) {
  const leftPriority = STATUS_PRIORITY[left.status ?? ''] ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = STATUS_PRIORITY[right.status ?? ''] ?? Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return parseCreatedTimestamp(right.createdAt) - parseCreatedTimestamp(left.createdAt);
}

/**
 * @param {string | undefined} createdAt
 * @returns {number}
 */
function parseCreatedTimestamp(createdAt) {
  if (!createdAt) {
    return 0;
  }

  const parsed = new Date(createdAt.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }

  return parsed.getTime();
}
