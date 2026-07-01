import assert from 'node:assert';
import { describe, it } from 'node:test';

import { z } from 'zod';

import { ToolRegistry } from '../../mcp/registry.js';
import { AnchorMcpServer } from '../../mcp/server.js';

describe('AnchorMcpServer', () => {
  it('registers tools and handles valid tool requests', async () => {
    const server = new AnchorMcpServer({ registry: new ToolRegistry() });

    server.registerTool({
      metadata: {
        name: 'echo',
        description: 'Echo input.',
        version: '1.0.0',
        category: 'test',
        exampleInput: { value: 'hello' },
        exampleOutput: { value: 'hello' },
      },
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({ value: input.value }),
    });

    const response = await server.handleToolRequest({
      toolName: 'echo',
      input: { value: 'hello' },
    });

    assert.deepStrictEqual(response, {
      ok: true,
      result: { value: 'hello' },
    });
  });

  it('returns ToolNotFound for unknown tools', async () => {
    const server = new AnchorMcpServer({ registry: new ToolRegistry() });

    const response = await server.handleToolRequest({
      toolName: 'missing_tool',
      input: {},
    });

    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error.code, 'ToolNotFound');
    assert.strictEqual(response.error.message, "I couldn't run that action because it is not available.");
  });

  it('returns ValidationError for invalid input', async () => {
    const server = new AnchorMcpServer({ registry: new ToolRegistry() });

    server.registerTool({
      metadata: {
        name: 'echo',
        description: 'Echo input.',
        version: '1.0.0',
        category: 'test',
        exampleInput: { value: 'hello' },
        exampleOutput: { value: 'hello' },
      },
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({ value: input.value }),
    });

    const response = await server.handleToolRequest({
      toolName: 'echo',
      input: { value: 123 },
    });

    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error.code, 'ValidationError');
    assert.strictEqual(response.error.message, "I couldn't complete that request because some details were invalid.");
    assert.strictEqual('details' in response.error, false);
  });

  it('returns ExecutionError when execution fails', async () => {
    const server = new AnchorMcpServer({ registry: new ToolRegistry() });

    server.registerTool({
      metadata: {
        name: 'failing_tool',
        description: 'Fails.',
        version: '1.0.0',
        category: 'test',
        exampleInput: {},
        exampleOutput: {},
      },
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error('failure');
      },
    });

    const response = await server.handleToolRequest({
      toolName: 'failing_tool',
      input: {},
    });

    assert.strictEqual(response.ok, false);
    assert.strictEqual(response.error.code, 'ExecutionError');
    assert.strictEqual(response.error.message, "I couldn't complete that request right now. Please try again.");
  });

  it('lists tool discovery metadata', () => {
    const server = new AnchorMcpServer({ registry: new ToolRegistry() });

    server.registerTool({
      metadata: {
        name: 'echo',
        description: 'Echo input.',
        version: '1.0.0',
        category: 'test',
        exampleInput: { value: 'hello' },
        exampleOutput: { value: 'hello' },
      },
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({ value: input.value }),
    });

    const [tool] = server.listTools();

    assert.strictEqual(tool.name, 'echo');
    assert.strictEqual(tool.inputSchema.type, 'object');
    assert.deepStrictEqual(tool.exampleInput, { value: 'hello' });
  });

  it('logs tool calls, validation failures, and execution failures', async () => {
    const logs = [];
    const logger = {
      debug: (message, context) => logs.push({ level: 'debug', message, context }),
      info: (message, context) => logs.push({ level: 'info', message, context }),
      warn: (message, context) => logs.push({ level: 'warn', message, context }),
      error: (message, context) => logs.push({ level: 'error', message, context }),
    };
    const server = new AnchorMcpServer({ registry: new ToolRegistry(), logger });

    server.registerTool({
      metadata: {
        name: 'echo',
        description: 'Echo input.',
        version: '1.0.0',
        category: 'test',
        exampleInput: { value: 'hello' },
        exampleOutput: { value: 'hello' },
      },
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => ({ value: input.value }),
    });
    server.registerTool({
      metadata: {
        name: 'failing_tool',
        description: 'Fails.',
        version: '1.0.0',
        category: 'test',
        exampleInput: {},
        exampleOutput: {},
      },
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error('failure');
      },
    });

    await server.handleToolRequest({ toolName: 'echo', input: { value: 'hello' } });
    await server.handleToolRequest({ toolName: 'echo', input: { value: 123 } });
    await server.handleToolRequest({ toolName: 'failing_tool', input: {} });

    assert.ok(logs.some((log) => log.message === 'MCP tool called' && log.context.toolName === 'echo'));
    assert.ok(logs.some((log) => log.message === 'MCP tool validation failed'));
    assert.ok(logs.some((log) => log.message === 'MCP tool execution failed'));
  });
});
