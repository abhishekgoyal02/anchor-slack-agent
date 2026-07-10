import { GoogleGenAI } from '@google/genai';

import { createAnchorMcpServer } from '../mcp/index.js';
import { silentMcpLogger } from '../mcp/logger.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_TOOL_ITERATIONS = 5;
const EMPTY_TOPIC_SEARCH_MESSAGES = [
  (topic) => `🐿 Nothing on **${topic}** right now. Looks like nobody has picked it up yet.`,
  (topic) => `🐧 No commitments found for **${topic}**. Guess this one's still waiting for its first owner.`,
];
const DEFAULT_TOOL_CALLING_SYSTEM_INSTRUCTION = [
  'Format search_commitments answers as plain text only.',
  'Choose the Ask Anchor answer style from the user query before writing the answer.',
  'For search, show, list, find, open, completed, overdue, and today commitment queries, use the metadata-line search style.',
  'For who owns, who is working on, who is handling, who is doing, and who is responsible for queries, use the grouped ownership style.',
  'Do not mix metadata-line search formatting with grouped ownership formatting in the same answer.',
  'For search style, use this exact top layout: I found <count> commitments related to <query>:',
  'For search style, render one bullet per commitment with every field on the same line.',
  'Keep this exact field order and bold only these labels: **Title:**, **Status:**, **Assignee:**, **Created At:**, **Updated At:**, **GitHub Issue:**',
  'Never put fields on separate lines and never use commas between fields.',
  'Use each provided status exactly as returned by the tool.',
  'Format Created At and Updated At as YYYY-MM-DD only.',
  'If assignee is missing, omit the Assignee field entirely.',
  'If assignee is a Slack user ID like U123ABC45, format it as a mention: <@U123ABC45>.',
  'For GitHub issue, show only # followed by the issue number after the label, for example: GitHub Issue: #12.',
  'For ownership style, group results by assignee and do not include Created At, Updated At, or GitHub Issue.',
  'Never expose Context Snapshot fields such as Summary, Requirements, Need to, Dependencies, Risk, Complexity, Labels, or Due Date.',
  'Never output internal fields such as channel, thread, or database IDs.',
  'If a topic search has no results, use exactly one of these empty-state messages with the topic inserted: 🐿 Nothing on **<topic>** right now. Looks like nobody has picked it up yet. OR 🐧 No commitments found for **<topic>**. Guess this one\'s still waiting for its first owner.',
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
          const toolFormattedText = formatSearchCommitmentToolAnswer(toolCalls, prompt);
          const finalText = toolFormattedText ?? text;

          if (!finalText) {
            throw new GeminiServiceError('Gemini returned an empty response.');
          }

          contents.push({
            role: 'model',
            parts: [{ text: finalText }],
          });
          logger.info('Gemini final response generated', { toolCallCount: toolCalls.length });

          return {
            text: finalText,
            history: contents,
            toolCalls,
          };
        }

        if (iteration === maxToolIterations) {
          throw new GeminiServiceError('Gemini tool-calling iteration limit exceeded.');
        }

        contents.push({
          role: 'model',
          parts: getFunctionCallParts(response, functionCalls),
        });

        const functionResponseParts = [];

        for (const functionCall of functionCalls) {
          const toolName = functionCall.name;
          const toolCallId = typeof functionCall.id === 'string' ? functionCall.id : undefined;
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
              ...(toolCallId ? { id: toolCallId } : {}),
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

      const detail = error instanceof Error ? error.message : String(error);
      throw new GeminiServiceError(`Failed to generate Gemini tool-calling response: ${detail}`, {
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
 * Preserve the original SDK function-call parts so required metadata such as
 * thought signatures survives the second Gemini request.
 * @param {unknown} response
 * @param {Array<{ name?: string, args?: unknown }>} functionCalls
 * @returns {Array<Record<string, unknown>>}
 */
function getFunctionCallParts(response, functionCalls) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const functionCallParts = parts.filter((part) => part?.functionCall);
    if (functionCallParts.length > 0) {
      return functionCallParts.map(toJsonObject);
    }
  }

  return functionCalls.map((functionCall) => ({ functionCall }));
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function toJsonObject(value) {
  return JSON.parse(JSON.stringify(value));
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

/**
 * @param {GeminiToolCallTrace[]} toolCalls
 * @param {string} prompt
 * @returns {string | null}
 */
function formatSearchCommitmentToolAnswer(toolCalls, prompt) {
  const searchCall = findLastSearchCommitmentToolCall(toolCalls);
  if (!searchCall?.response.ok || !Array.isArray(searchCall.response.result)) {
    return null;
  }

  const query = typeof searchCall.args.query === 'string' ? searchCall.args.query : '';
  const results = searchCall.response.result;
  const promptIntent = getAnswerIntent(prompt);
  const toolIntent = getAnswerIntent(query);
  const answerIntent = promptIntent.kind === 'topic' && toolIntent.kind !== 'topic' ? toolIntent : promptIntent;
  const answerTopic = answerIntent.topic || toolIntent.topic || query;

  if (results.length === 0) {
    if (answerIntent.kind === 'blockers') {
      return "I couldn't find any open commitments that are likely to block the upcoming release.";
    }

    if (answerIntent.kind === 'ownership') {
      return `I couldn't find anyone working on ${answerTopic}.`;
    }

    if (answerIntent.kind === 'overdue') {
      return "🦊 Good news — there isn't any overdue work right now.";
    }

    if (toolCalls.length > 1) {
      return null;
    }

    return formatEmptyTopicSearchAnswer(answerTopic || query);
  }

  if (answerIntent.kind === 'ownership') {
    return formatOwnershipAnswer(answerTopic, results);
  }

  if (answerIntent.kind === 'open' || answerIntent.kind === 'completed' || answerIntent.kind === 'overdue' || answerIntent.kind === 'today') {
    return formatStatusAnswer(answerIntent.kind, results);
  }

  if (answerIntent.kind === 'blockers') {
    return formatBlockerAnswer(results);
  }

  const topic = answerTopic;
  const lines = [`I found ${results.length} commitments related to ${topic}:`, ''];

  results.forEach((result, index) => {
    const commitment = normalizeSearchResult(result);
    lines.push(`• ${formatCommitmentMetadataLine(commitment)}`);

    if (index < results.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * @param {GeminiToolCallTrace[]} toolCalls
 * @returns {GeminiToolCallTrace | undefined}
 */
function findLastSearchCommitmentToolCall(toolCalls) {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    if (toolCalls[index]?.name === 'search_commitments') {
      return toolCalls[index];
    }
  }

  return undefined;
}

/**
 * @param {string} topic
 * @returns {string}
 */
function formatEmptyTopicSearchAnswer(topic) {
  const normalizedTopic = topic.trim() || 'that';
  const index = Math.random() < 0.5 ? 0 : 1;
  return EMPTY_TOPIC_SEARCH_MESSAGES[index](normalizedTopic);
}

/**
 * @param {string} query
 * @returns {{
 *   kind: 'topic' | 'ownership' | 'open' | 'completed' | 'overdue' | 'today' | 'blockers',
 *   topic: string,
 * }}
 */
function getAnswerIntent(query) {
  const normalized = normalizeAnswerQuery(query);
  const topic = extractAnswerTopic(query);

  if (isBlockerAnswerQuery(normalized)) {
    return { kind: 'blockers', topic };
  }

  if (/\boverdue\b/.test(normalized)) {
    return { kind: 'overdue', topic };
  }

  if (/\b(?:today|todays)\b/.test(normalized)) {
    return { kind: 'today', topic };
  }

  if (/\bcompleted\b/.test(normalized)) {
    return { kind: 'completed', topic };
  }

  if (/\bopen\b/.test(normalized)) {
    return { kind: 'open', topic };
  }

  if (isOwnershipAnswerQuery(normalized)) {
    return { kind: 'ownership', topic };
  }

  return { kind: 'topic', topic };
}

/**
 * @param {string} normalizedQuery
 * @returns {boolean}
 */
function isBlockerAnswerQuery(normalizedQuery) {
  return /\b(?:blocking|blockers?|delaying|finished|remains?)\b/.test(normalizedQuery);
}

/**
 * @param {string} normalizedQuery
 * @returns {boolean}
 */
function isOwnershipAnswerQuery(normalizedQuery) {
  return /\b(?:who\s+(?:owns?|is\s+(?:working\s+on|handling|doing|responsible\s+for)|s\s+(?:working\s+on|handling|doing))|whos\s+(?:working\s+on|handling|doing))\b/.test(
    normalizedQuery,
  );
}

/**
 * @param {string} query
 * @returns {string}
 */
function normalizeAnswerQuery(query) {
  return query
    .toLowerCase()
    .replace(/\bwho['’]?s\b/g, 'whos')
    .replace(/\btoday['’]?s\b/g, 'todays')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} query
 * @returns {string}
 */
function extractAnswerTopic(query) {
  const words = query
    .replace(/\bwho['’]?s\b/gi, 'whos')
    .replace(/\btoday['’]?s\b/gi, 'todays')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(
      (word) =>
        word &&
        ![
          'a',
          'about',
          'an',
          'and',
          'any',
          'anything',
          'are',
          'before',
          'commitment',
          'commitments',
          'doing',
          'find',
          'for',
          'handling',
          'is',
          'list',
          'me',
          'on',
          'owns',
          'please',
          'responsible',
          'related',
          'search',
          'show',
          'the',
          'this',
          'to',
          'need',
          'needs',
          's',
          'still',
          'what',
          'who',
          'whos',
          'work',
          'working',
        ].includes(word.toLowerCase()),
    );

  return words.join(' ');
}

/**
 * @param {string[]} fields
 * @param {string} label
 * @param {string} formatted
 * @returns {void}
 */
function appendOptionalSearchField(fields, label, formatted) {
  if (!formatted) {
    return;
  }

  fields.push(`**${label}:** ${formatted}.`);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatRequiredSearchField(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const formatted = String(value).trim();
  return formatted;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function normalizeSearchResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }

  return {};
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatSentenceSearchField(value) {
  const formatted = formatSearchTitle(value);
  if (!formatted) {
    return '.';
  }

  return /[.!?]$/.test(formatted) ? formatted : `${formatted}.`;
}

/**
 * @param {Record<string, unknown>} commitment
 * @returns {string}
 */
function formatCommitmentMetadataLine(commitment) {
  const fields = [
    `**Title:** ${formatSentenceSearchField(commitment.title)}`,
    `**Status:** ${formatSearchStatus(commitment.status)}.`,
  ];

  appendOptionalSearchField(fields, 'Assignee', formatSearchAssignee(commitment.assignee));
  fields.push(`**Created At:** ${formatSearchDate(commitment.createdAt)}.`);
  fields.push(`**Updated At:** ${formatSearchDate(commitment.updatedAt)}.`);
  appendOptionalSearchField(fields, 'GitHub Issue', formatSearchGithubIssue(commitment.githubIssue));

  return fields.join(' ');
}

/**
 * @param {string} topic
 * @param {unknown[]} results
 * @returns {string}
 */
function formatOwnershipAnswer(topic, results) {
  const groups = groupResultsByAssignee(results);
  const lines = [`👥 Here's who is working on ${topic}:`, ''];
  let groupIndex = 0;

  for (const [assignee, commitments] of groups) {
    lines.push(`• ${assignee}`);
    commitments.forEach((commitment) => {
      lines.push(`  - ${formatBareTitle(commitment.title)} (${formatPlainStatus(commitment.status)})`);
    });

    groupIndex += 1;
    if (groupIndex < groups.size) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * @param {'open' | 'completed' | 'overdue' | 'today'} kind
 * @param {unknown[]} results
 * @returns {string}
 */
function formatStatusAnswer(kind, results) {
  const headings = {
    open: 'Open commitments:',
    completed: 'Completed commitments:',
    overdue: 'Overdue commitments:',
    today: "Today's commitments:",
  };
  const lines = [headings[kind], ''];

  results.forEach((result, index) => {
    lines.push(`• ${formatCommitmentMetadataLine(normalizeSearchResult(result))}`);

    if (index < results.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * @param {unknown[]} results
 * @returns {string}
 */
function formatBlockerAnswer(results) {
  if (results.length === 0) {
    return "I couldn't find any open commitments that are likely to block the upcoming release.";
  }

  const groups = groupResultsByAssignee(results);
  const lines = ['Potential release blockers:', ''];
  let count = 0;
  let groupIndex = 0;

  for (const [assignee, commitments] of groups) {
    lines.push(assignee);
    for (const commitment of commitments) {
      lines.push(`  ${formatBareTitle(commitment.title)}`);
      count += 1;
    }

    groupIndex += 1;
    if (groupIndex < groups.size) {
      lines.push('');
    }
  }

  lines.push('', `${count} open ${count === 1 ? 'commitment may' : 'commitments may'} impact the next release.`);
  return lines.join('\n');
}

/**
 * @param {unknown[]} results
 * @returns {Map<string, Array<Record<string, unknown>>>}
 */
function groupResultsByAssignee(results) {
  const groups = new Map();

  for (const result of results) {
    const commitment = normalizeSearchResult(result);
    const assignee = formatSearchAssignee(commitment.assignee) || 'Unassigned';
    const existing = groups.get(assignee) ?? [];
    existing.push(commitment);
    groups.set(assignee, existing);
  }

  return groups;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatBareTitle(value) {
  const formatted = formatSearchTitle(value);
  return formatted.replace(/[.!?]+$/g, '');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatSearchTitle(value) {
  const formatted = formatRequiredSearchField(value);
  if (!formatted) {
    return '';
  }

  const titleLines = [];
  for (const line of formatted.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    if (isContextSnapshotHeading(trimmedLine)) {
      break;
    }

    titleLines.push(trimmedLine);
  }

  return titleLines.join(' ').trim();
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isContextSnapshotHeading(line) {
  return /^(?:#{1,6}\s*)?(?:Summary|Requirements|Need to|Dependencies|Risk|Potential Risks|Complexity|Labels|Due Date|Context Snapshot|Generated Context|generated_context)(?::\s*.*)?$/i.test(
    line,
  );
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatOptionalSearchField(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  const formatted = String(value).trim();
  if (/^(none|null|undefined)$/i.test(formatted)) {
    return '';
  }

  return formatted;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatSearchDate(value) {
  return formatRequiredSearchField(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatSearchAssignee(value) {
  const formatted = formatOptionalSearchField(value);
  if (!formatted) {
    return '';
  }

  if (/^(?:<@)?U(?:123|999)>?$/i.test(formatted)) {
    return 'Unassigned';
  }

  if (/^<@[^>]+>$/.test(formatted)) {
    return formatted;
  }

  if (/^U[A-Z0-9]+$/.test(formatted)) {
    return `<@${formatted}>`;
  }

  return formatted;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatPlainStatus(value) {
  const formatted = formatRequiredSearchField(value);
  return formatted || 'Unknown';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatSearchGithubIssue(value) {
  const formatted = formatOptionalSearchField(value);
  if (!formatted) {
    return '';
  }

  const issueNumber = formatted.match(/\d+/)?.[0];
  return issueNumber ? `#${issueNumber}` : formatted;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatSearchStatus(value) {
  const formatted = formatRequiredSearchField(value);
  if (!formatted) {
    return '⚫ Unknown';
  }

  const normalizedStatus = formatted.toLowerCase();
  if (normalizedStatus === 'open') {
    return '🟡 Open';
  }

  if (normalizedStatus === 'completed') {
    return '✅ Completed';
  }

  if (normalizedStatus === 'in progress') {
    return '🔵 In Progress';
  }

  if (normalizedStatus === 'blocked') {
    return '🔴 Blocked';
  }

  if (normalizedStatus === 'archived') {
    return '⚪ Archived';
  }

  if (normalizedStatus === 'unknown') {
    return '⚫ Unknown';
  }

  return `⚫ ${formatted}`;
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
