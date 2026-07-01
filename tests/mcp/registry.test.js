import assert from 'node:assert';
import { describe, it } from 'node:test';

import { z } from 'zod';

import { ToolRegistry } from '../../mcp/registry.js';

function createTool(name) {
  return {
    metadata: {
      name,
      description: `${name} description`,
      version: '1.0.0',
      category: 'test',
      exampleInput: {},
      exampleOutput: {},
    },
    inputSchema: z.object({}),
    execute: async () => ({}),
  };
}

describe('ToolRegistry', () => {
  it('registers and finds a tool', () => {
    const registry = new ToolRegistry();
    const tool = createTool('search_commitments');

    registry.register(tool);

    assert.strictEqual(registry.find('search_commitments'), tool);
  });

  it('exposes tool discovery metadata', () => {
    const registry = new ToolRegistry();

    registry.register(createTool('search_commitments'));

    const [tool] = registry.listTools();
    assert.strictEqual(tool.name, 'search_commitments');
    assert.strictEqual(tool.description, 'search_commitments description');
    assert.strictEqual(tool.version, '1.0.0');
    assert.strictEqual(tool.category, 'test');
    assert.deepStrictEqual(tool.exampleInput, {});
    assert.deepStrictEqual(tool.exampleOutput, {});
    assert.strictEqual(tool.inputSchema.type, 'object');
  });

  it('rejects duplicate registrations', () => {
    const registry = new ToolRegistry();

    registry.register(createTool('search_commitments'));

    assert.throws(() => registry.register(createTool('search_commitments')), /Tool already registered/);
  });

  it('rejects tools that do not follow the contract', () => {
    const registry = new ToolRegistry();

    assert.throws(
      () =>
        registry.register({
          metadata: {
            name: 'missing_contract',
            description: 'Missing required metadata.',
          },
          inputSchema: z.object({}),
          execute: async () => ({}),
        }),
      /metadata.version is required/,
    );
  });
});
