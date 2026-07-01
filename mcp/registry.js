import { toDiscoverySchema } from './server.js';

/**
 * Registry for Anchor MCP tools.
 */
export class ToolRegistry {
  /** @type {Map<string, import('./server.js').McpTool>} */
  #tools = new Map();

  /**
   * Register one tool.
   * @param {import('./server.js').McpTool} tool
   * @returns {void}
   */
  register(tool) {
    validateToolContract(tool);
    const name = tool.metadata.name;

    if (this.#tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }

    this.#tools.set(name, tool);
  }

  /**
   * Find a tool by name.
   * @param {string} name
   * @returns {import('./server.js').McpTool | undefined}
   */
  find(name) {
    return this.#tools.get(name);
  }

  /**
   * Return discovery metadata for all registered tools.
   * @returns {Array<import('./server.js').McpToolDiscovery>}
   */
  listTools() {
    return Array.from(this.#tools.values()).map((tool) => ({
      ...tool.metadata,
      inputSchema: toDiscoverySchema(tool.inputSchema),
    }));
  }
}

/**
 * Validate the standard MCP tool contract.
 * @param {import('./server.js').McpTool} tool
 * @returns {void}
 */
function validateToolContract(tool) {
  if (!tool?.metadata?.name) {
    throw new Error('Tool metadata.name is required.');
  }

  if (!tool.metadata.description) {
    throw new Error(`Tool metadata.description is required: ${tool.metadata.name}`);
  }

  if (!tool.metadata.version) {
    throw new Error(`Tool metadata.version is required: ${tool.metadata.name}`);
  }

  if (!tool.metadata.category) {
    throw new Error(`Tool metadata.category is required: ${tool.metadata.name}`);
  }

  if (!('exampleInput' in tool.metadata)) {
    throw new Error(`Tool metadata.exampleInput is required: ${tool.metadata.name}`);
  }

  if (!('exampleOutput' in tool.metadata)) {
    throw new Error(`Tool metadata.exampleOutput is required: ${tool.metadata.name}`);
  }

  if (!tool.inputSchema?.parse) {
    throw new Error(`Tool inputSchema is required: ${tool.metadata.name}`);
  }

  if (typeof tool.execute !== 'function') {
    throw new Error(`Tool execute() is required: ${tool.metadata.name}`);
  }
}
