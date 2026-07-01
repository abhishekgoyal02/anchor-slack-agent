# Anchor MCP Architecture

Anchor MCP is the internal tool boundary for Gemini-powered capabilities.
Gemini can discover MCP tools dynamically and call them through the Gemini
service tool-calling mode. Slack listeners are not connected to this mode yet.

## Architecture

```text
Slack
  -> Bolt
  -> Gemini
  -> Anchor MCP Server
  -> MCP Tool
  -> Business Service
  -> Storage
  -> SQLite / GitHub
```

Phase 4 adds Gemini tool calling against this MCP boundary. It does not add
Slack commands, Block Kit, or user-facing AI features.

## Folder Responsibilities

* `mcp/server.js` - request handling, centralized validation, structured errors,
  tool execution, discovery, and logging.
* `mcp/registry.js` - tool registration, duplicate-name protection, contract
  validation, and discovery metadata assembly.
* `mcp/logger.js` - default no-op logger and logger shape for dependency
  injection.
* `mcp/tools/` - independent tool factories. Each factory returns the standard
  tool contract: `metadata`, `inputSchema`, and `execute()`.
* `services/` - business orchestration and DTO mapping. Tools call services,
  not storage.
* `storage/` - database operations and schema ownership.

## Tool Lifecycle

1. A tool module exports a factory.
2. The factory receives dependencies, usually business services.
3. The factory returns `{ metadata, inputSchema, execute }`.
4. `createAnchorMcpServer()` registers the tool.
5. The registry validates the tool contract and rejects duplicate names.
6. `server.listTools()` exposes JSON-serializable discovery metadata.
7. `server.handleToolRequest()` validates input, executes the tool, logs the
   lifecycle, and returns structured JSON.

## Tool Contract

Every tool must return the same interface:

```js
{
  metadata: {
    name,
    description,
    version,
    category,
    exampleInput,
    exampleOutput,
  },
  inputSchema,
  execute,
}
```

Validation belongs to `mcp/server.js`. Tool `execute()` functions receive
already validated input.

## Adding a Tool

1. Create `mcp/tools/my-tool.js`.
2. Export a factory that receives dependencies.
3. Return the standard tool contract.
4. Add one registration line in `mcp/index.js`.
5. Add unit tests for metadata, injected dependencies, validation through the
   server, and execution errors.

## Gemini Integration Plan

`GeminiService.generateTextWithTools()` calls `server.listTools()` to discover
available tools and converts the discovery metadata into Gemini function
declarations. When Gemini returns `functionCalls`, the service executes each
request through `server.handleToolRequest()`, appends `functionResponse` parts to
the conversation, and continues the loop until Gemini returns a final text
answer.

The execution loop supports multiple tool calls:

```text
User prompt
  -> Gemini with MCP-discovered function declarations
  -> Gemini functionCall
  -> Anchor MCP server
  -> Tool result or structured error
  -> Gemini functionResponse
  -> Gemini may call another tool
  -> Gemini final natural-language answer
```

Gemini should not import storage or business services directly. MCP discovery is
the source of truth for available tools.

## Future Tool Notes

Reserved future tool names:

* `get_commitment`
* `list_overdue`
* `history_lookup`
* `find_duplicates`
* `predict_due_date`

These are architecture notes only. They are not registered and are not
implemented in Phase 3.5.
