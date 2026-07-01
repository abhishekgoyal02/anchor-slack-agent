import { GoogleGenAI } from '@google/genai';

import { createAnchorMcpServer } from '../mcp/index.js';
import { silentMcpLogger } from '../mcp/logger.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_TOOL_ITERATIONS = 5;
const DEFAULT_TOOL_CALLING_SYSTEM_INSTRUCTION = [
  'You are Anchor, a professional assistant responding for Slack users.',
  'MCP tool outputs are application records, not raw data to dump.',
  'Summarize results naturally and concisely instead of repeating every field.',
  'Never mention or expose internal IDs, database terms, SQL, channels, threads, or implementation details.',
  'When records include duplicate titles, clearly distinguish each one using user-facing fields such as status, GitHub issue, and created date.',
  "When a search returns no commitments, respond naturally (for example: I couldn't find any commitments related to the query).",
  'If a tool error appears, provide a brief, user-friendly explanation without technical internals.',
].join(' ');

/**
 * Error type used for Gemini service failures.
 *
 * The original error is preserved in `cause` so callers can log or inspect it
 * without exposing provider-specific details to user-facing surfaces.
 */
export class GeminiServiceError extends Error {
  /**
   * @param {string} message - Human-readable service error message.
   * @param {{ cause?: unknown }} [options] - Optional wrapped error details.
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'GeminiServiceError';
  }
}

/**
 * @typedef {object} GeminiServiceOptions
 * @property {string} [apiKey] - Google Gemini API key. Defaults to `process.env.GOOGLE_API_KEY`.
 * @property {string} [model] - Gemini model name. Defaults to `process.env.GEMINI_MODEL` or `gemini-2.5-flash`.
 * @property {GoogleGenAI} [client] - Optional preconfigured Gemini client for dependency injection.
 */

/**
 * @typedef {object} GenerateTextOptions
 * @property {string} [model] - Optional model override for this request.
 * @property {number} [temperature] - Optional sampling temperature.
 * @property {number} [topP] - Optional nucleus sampling value.
 * @property {number} [topK] - Optional top-k sampling value.
 * @property {number} [maxOutputTokens] - Optional maximum generated token count.
 * @property {string} [systemInstruction] - Optional system instruction for this request.
 */

/**
 * @typedef {GenerateTextOptions & {
 *   mcpServer?: import('../mcp/server.js').AnchorMcpServer,
 *   history?: Array<{ role: string, parts: Array<Record<string, unknown>> }>,
 *   maxToolIterations?: number,
 *   logger?: import('../mcp/logger.js').McpLogger,
 * }} GenerateWithToolsOptions
 */

/**
 * @typedef {{
 *   name: string,
 *   args: Record<string, unknown>,
 *   response: import('../mcp/server.js').McpToolResponse,
 *   durationMs: number,
 * }} GeminiToolCallTrace
 */

/**
 * @typedef {{
 *   text: string,
 *   history: Array<{ role: string, parts: Array<Record<string, unknown>> }>,
 *   toolCalls: GeminiToolCallTrace[],
 * }} GeminiToolCallingResult
 */

/**
 * Reusable Gemini text-generation service.
 *
 * This service intentionally has no Slack, GitHub, or SQLite coupling.
 * Higher-level application layers can pass prompts and generation options as
 * needed without changing this module.
 */
export class GeminiService {
  /** @type {GoogleGenAI} */
  #client;

  /** @type {string} */
  #model;

  /**
   * @param {GeminiServiceOptions} [options] - Service configuration.
   */
  constructor(options = {}) {
    const apiKey = options.apiKey?.trim() ?? process.env.GOOGLE_API_KEY?.trim();
    const model = options.model?.trim() ?? process.env.GEMINI_MODEL?.trim() ?? DEFAULT_MODEL;

    if (!apiKey && !options.client) {
      throw new GeminiServiceError('GOOGLE_API_KEY is required to initialize GeminiService.');
    }

    if (!model) {
      throw new GeminiServiceError('A Gemini model name is required.');
    }

    this.#client = options.client ?? new GoogleGenAI({ apiKey });
    this.#model = model;
  }

  /**
   * Returns the default model configured for this service instance.
   *
   * @returns {string} Gemini model name.
   */
  get model() {
    return this.#model;
  }

  /**
   * Generates plain text from a prompt.
   *
   * @param {string} prompt - User prompt to send to Gemini.
   * @param {GenerateTextOptions} [options] - Optional generation settings.
   * @returns {Promise<string>} Generated plain text.
   * @throws {GeminiServiceError} If the prompt is invalid, Gemini fails, or no text is returned.
   */
  async generateText(prompt, options = {}) {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new GeminiServiceError('A non-empty prompt is required.');
    }

    const model = options.model?.trim() ?? this.#model;
    const config = this.#buildGenerationConfig(options);

    try {
      const response = await this.#client.models.generateContent({
        model,
        contents: prompt,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });

      const text = response.text?.trim();

      if (!text) {
        throw new GeminiServiceError('Gemini returned an empty response.');
      }

      return text;
    } catch (error) {
      if (error instanceof GeminiServiceError) {
        throw error;
      }

      throw new GeminiServiceError('Failed to generate Gemini response.', {
        cause: error,
      });
    }
  }

  /**
   * Generates text with Gemini function calling backed by Anchor MCP tools.
   *
   * Gemini receives available tools from MCP discovery, decides whether to call
   * a tool, and gets structured MCP results back before producing the final
   * natural-language answer.
   *
   * @param {string} prompt - User prompt to send to Gemini.
   * @param {GenerateWithToolsOptions} [options] - Tool-calling options.
   * @returns {Promise<GeminiToolCallingResult>} Final response, updated history, and tool trace.
   */
  async generateTextWithTools(prompt, options = {}) {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new GeminiServiceError('A non-empty prompt is required.');
    }

    const model = options.model?.trim() ?? this.#model;
    const mcpServer = options.mcpServer ?? createAnchorMcpServer({ logger: options.logger });
    const logger = options.logger ?? silentMcpLogger;
    const maxToolIterations = normalizeMaxToolIterations(options.maxToolIterations);
    const contents = [
      ...(options.history ?? []),
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];
    const toolCalls = [];
    const config = {
      ...this.#buildGenerationConfig({
        ...options,
        systemInstruction: buildToolCallingSystemInstruction(options.systemInstruction),
      }),
      ...buildToolConfig(mcpServer.listTools()),
    };

    try {
      for (let iteration = 0; iteration <= maxToolIterations; iteration += 1) {
        const response = await this.#client.models.generateContent({
          model,
          contents,
          ...(Object.keys(config).length > 0 ? { config } : {}),
        });
        const functionCalls = getFunctionCalls(response);

        if (functionCalls.length === 0) {
          const text = response.text?.trim();

          if (!text) {
            throw new GeminiServiceError('Gemini returned an empty response.');
          }

          contents.push({
            role: 'model',
            parts: [{ text }],
          });
          logger.info('Gemini final response generated', { toolCallCount: toolCalls.length });

          return {
            text,
            history: contents,
            toolCalls,
          };
        }

        if (iteration === maxToolIterations) {
          throw new GeminiServiceError('Gemini tool-calling iteration limit exceeded.');
        }

        contents.push({
          role: 'model',
          parts: functionCalls.map((functionCall) => ({ functionCall })),
        });

        const functionResponseParts = [];

        for (const functionCall of functionCalls) {
          const toolName = functionCall.name;
          const args = normalizeFunctionArgs(functionCall.args);

          if (!toolName) {
            functionResponseParts.push({
              functionResponse: {
                name: 'unknown_tool',
                response: {
                  error: {
                    code: 'ToolNotFound',
                    message: 'Gemini requested a tool without a name.',
                  },
                },
              },
            });
            continue;
          }

          logger.info('Gemini requested MCP tool', { toolName });
          const startedAt = Date.now();
          logger.info('MCP tool execution started', { toolName });
          const toolResponse = await mcpServer.handleToolRequest({
            toolName,
            input: args,
          });
          const durationMs = Date.now() - startedAt;
          logger.info('MCP tool execution finished', {
            toolName,
            durationMs,
            ok: toolResponse.ok,
          });

          toolCalls.push({
            name: toolName,
            args,
            response: toolResponse,
            durationMs,
          });
          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: toolResponse.ok ? { output: toolResponse.result } : { error: toolResponse.error },
            },
          });
        }

        contents.push({
          role: 'user',
          parts: functionResponseParts,
        });
      }
    } catch (error) {
      if (error instanceof GeminiServiceError) {
        throw error;
      }

      throw new GeminiServiceError('Failed to generate Gemini tool-calling response.', {
        cause: error,
      });
    }

    throw new GeminiServiceError('Gemini tool-calling loop ended unexpectedly.');
  }

  /**
   * Builds the Gemini generation config from supported request options.
   *
   * @param {GenerateTextOptions} options - Generation options.
   * @returns {Record<string, string | number>} Gemini generation config.
   */
  #buildGenerationConfig(options) {
    /** @type {Record<string, string | number>} */
    const config = {};

    if (options.temperature !== undefined) {
      config.temperature = options.temperature;
    }

    if (options.topP !== undefined) {
      config.topP = options.topP;
    }

    if (options.topK !== undefined) {
      config.topK = options.topK;
    }

    if (options.maxOutputTokens !== undefined) {
      config.maxOutputTokens = options.maxOutputTokens;
    }

    if (options.systemInstruction !== undefined) {
      config.systemInstruction = options.systemInstruction;
    }

    return config;
  }
}

/**
 * @param {unknown} maxToolIterations
 * @returns {number}
 */
function normalizeMaxToolIterations(maxToolIterations) {
  if (typeof maxToolIterations === 'number' && Number.isInteger(maxToolIterations) && maxToolIterations >= 0) {
    return maxToolIterations;
  }

  return DEFAULT_MAX_TOOL_ITERATIONS;
}

/**
 * @param {Array<import('../mcp/server.js').McpToolDiscovery>} tools
 * @returns {{ tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }> }}
 */
function buildToolConfig(tools) {
  if (tools.length === 0) {
    return {};
  }

  return {
    tools: [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: `${tool.description} Category: ${tool.category}. Version: ${tool.version}.`,
          parametersJsonSchema: tool.inputSchema,
        })),
      },
    ],
  };
}

/**
 * @param {unknown} response
 * @returns {Array<{ name?: string, args?: unknown }>}
 */
function getFunctionCalls(response) {
  if (Array.isArray(response?.functionCalls)) {
    return response.functionCalls;
  }

  return [];
}

/**
 * @param {unknown} args
 * @returns {Record<string, unknown>}
 */
function normalizeFunctionArgs(args) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return /** @type {Record<string, unknown>} */ (args);
  }

  return {};
}

/**
 * @param {string | undefined} overrideInstruction
 * @returns {string}
 */
function buildToolCallingSystemInstruction(overrideInstruction) {
  if (typeof overrideInstruction === 'string' && overrideInstruction.trim()) {
    return `${DEFAULT_TOOL_CALLING_SYSTEM_INSTRUCTION} ${overrideInstruction.trim()}`;
  }

  return DEFAULT_TOOL_CALLING_SYSTEM_INSTRUCTION;
}

/** @type {GeminiService | null} */
let defaultGeminiService = null;

/**
 * Returns the lazily initialized default Gemini service instance.
 *
 * Lazy initialization keeps this module safe to import in tests and app startup
 * paths before environment validation is intentionally triggered.
 *
 * @returns {GeminiService} Default Gemini service instance.
 */
export function getDefaultGeminiService() {
  defaultGeminiService ??= new GeminiService();
  return defaultGeminiService;
}

/**
 * Generates plain text using the default Gemini service instance.
 *
 * This helper is intentionally small so Phase 1 can verify Gemini without
 * introducing Slack, GitHub, or SQLite dependencies.
 *
 * @param {string} prompt - User prompt to send to Gemini.
 * @param {GenerateTextOptions} [options] - Optional generation settings.
 * @returns {Promise<string>} Generated plain text.
 */
export async function generateResponse(prompt, options = {}) {
  const result = await getDefaultGeminiService().generateTextWithTools(prompt, options);
  return result.text;
}

export default GeminiService;
