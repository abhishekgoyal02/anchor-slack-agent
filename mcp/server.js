import { ZodError, z } from 'zod';

import { silentMcpLogger } from './logger.js';

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   version: string,
 *   category: string,
 *   exampleInput: unknown,
 *   exampleOutput: unknown,
 * }} McpToolMetadata
 */

/**
 * @typedef {{
 *   metadata: McpToolMetadata,
 *   inputSchema: import('zod').ZodType,
 *   execute: (input: unknown) => Promise<unknown> | unknown,
 * }} McpTool
 */

/**
 * @typedef {McpToolMetadata & {
 *   inputSchema: unknown,
 * }} McpToolDiscovery
 */

/**
 * @typedef {{
 *   ok: true,
 *   result: unknown,
 * } | {
 *   ok: false,
 *   error: {
 *     code: 'ToolNotFound' | 'ValidationError' | 'ExecutionError',
 *     message: string,
 *     details?: unknown,
 *   },
 * }} McpToolResponse
 */

/**
 * Lightweight MCP server abstraction for Anchor tools.
 */
export class AnchorMcpServer {
  /**
   * @param {{
   *   registry: import('./registry.js').ToolRegistry,
   *   logger?: import('./logger.js').McpLogger,
   * }} options
   */
  constructor({ registry, logger = silentMcpLogger }) {
    this.registry = registry;
    this.logger = logger;
  }

  /**
   * Register one tool.
   * @param {McpTool} tool
   * @returns {void}
   */
  registerTool(tool) {
    this.registry.register(tool);
  }

  /**
   * Return discovery metadata for registered tools.
   * @returns {McpToolDiscovery[]}
   */
  listTools() {
    return this.registry.listTools();
  }

  /**
   * Handle a tool request and return structured JSON.
   * @param {{ toolName: string, input?: unknown }} request
   * @returns {Promise<McpToolResponse>}
   */
  async handleToolRequest({ toolName, input = {} }) {
    const tool = this.registry.find(toolName);
    const startedAt = Date.now();

    if (!tool) {
      this.logger.warn('MCP tool not found', { toolName });
      return {
        ok: false,
        error: {
          code: 'ToolNotFound',
          message: "I couldn't run that action because it is not available.",
        },
      };
    }

    this.logger.info('MCP tool called', { toolName });

    try {
      const validatedInput = tool.inputSchema.parse(input);
      const result = await tool.execute(validatedInput);
      const durationMs = Date.now() - startedAt;

      this.logger.info('MCP tool completed', { toolName, durationMs });

      return {
        ok: true,
        result,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        const durationMs = Date.now() - startedAt;
        this.logger.warn('MCP tool validation failed', {
          toolName,
          durationMs,
          issues: error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        });

        return {
          ok: false,
          error: {
            code: 'ValidationError',
            message: "I couldn't complete that request because some details were invalid.",
          },
        };
      }

      const durationMs = Date.now() - startedAt;
      this.logger.error('MCP tool execution failed', {
        toolName,
        durationMs,
        message: error instanceof Error ? error.message : 'Tool execution failed.',
      });

      return {
        ok: false,
        error: {
          code: 'ExecutionError',
          message: "I couldn't complete that request right now. Please try again.",
        },
      };
    }
  }
}

/**
 * Convert a Zod schema into a JSON-serializable discovery schema.
 * @param {import('zod').ZodType} inputSchema
 * @returns {unknown}
 */
export function toDiscoverySchema(inputSchema) {
  return z.toJSONSchema(inputSchema);
}
