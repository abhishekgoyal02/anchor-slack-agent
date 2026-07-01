import { searchCommitments } from '../services/commitment-search-service.js';
import { ToolRegistry } from './registry.js';
import { AnchorMcpServer } from './server.js';
import { createSearchCommitmentsTool } from './tools/search-commitments.js';

/**
 * Create the default Anchor MCP server with all current tools registered.
 * @param {{
 *   logger?: import('./logger.js').McpLogger,
 *   services?: {
 *     commitmentSearchService?: typeof searchCommitments,
 *   },
 * }} [options]
 * @returns {AnchorMcpServer}
 */
export function createAnchorMcpServer(options = {}) {
  const registry = new ToolRegistry();
  const server = new AnchorMcpServer({ registry, logger: options.logger });
  const services = {
    commitmentSearchService: options.services?.commitmentSearchService ?? searchCommitments,
  };

  server.registerTool(createSearchCommitmentsTool(services));

  return server;
}

export { ToolRegistry } from './registry.js';
export { AnchorMcpServer } from './server.js';
export { createSearchCommitmentsTool } from './tools/search-commitments.js';
