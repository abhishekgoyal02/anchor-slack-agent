import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  GeminiService,
  GeminiServiceError,
  generateResponse,
  getDefaultGeminiService,
} from '../../services/gemini-service.js';

describe('gemini-service', () => {
  describe('GeminiService', () => {
    it('uses explicit configuration and generates text with a mocked client', async () => {
      let passedParams = null;
      const mockClient = /** @type {any} */ ({
        models: {
          generateContent: async (params) => {
            passedParams = params;
            return { text: 'Hello from mock Gemini!' };
          },
        },
      });

      const service = new GeminiService({
        apiKey: 'mock-key',
        client: mockClient,
        model: 'mock-model',
      });

      const response = await service.generateText('Say hello', {
        maxOutputTokens: 100,
        systemInstruction: 'Be polite.',
        temperature: 0.7,
      });

      assert.strictEqual(service.model, 'mock-model');
      assert.strictEqual(response, 'Hello from mock Gemini!');
      assert.deepStrictEqual(passedParams, {
        model: 'mock-model',
        contents: 'Say hello',
        config: {
          temperature: 0.7,
          maxOutputTokens: 100,
          systemInstruction: 'Be polite.',
        },
      });
    });

    it('uses environment configuration and the default model fallback', () => {
      const originalKey = process.env.GOOGLE_API_KEY;
      const originalModel = process.env.GEMINI_MODEL;

      try {
        process.env.GOOGLE_API_KEY = 'env-api-key';
        delete process.env.GEMINI_MODEL;

        const service = new GeminiService({
          client: /** @type {any} */ ({ models: { generateContent: async () => ({ text: 'ok' }) } }),
        });

        assert.strictEqual(service.model, 'gemini-2.5-flash');
      } finally {
        restoreEnv('GOOGLE_API_KEY', originalKey);
        restoreEnv('GEMINI_MODEL', originalModel);
      }
    });

    it('prioritizes constructor options over environment variables', () => {
      const originalKey = process.env.GOOGLE_API_KEY;
      const originalModel = process.env.GEMINI_MODEL;

      try {
        process.env.GOOGLE_API_KEY = 'env-api-key';
        process.env.GEMINI_MODEL = 'env-model';

        const service = new GeminiService({
          apiKey: 'option-api-key',
          client: /** @type {any} */ ({ models: { generateContent: async () => ({ text: 'ok' }) } }),
          model: 'option-model',
        });

        assert.strictEqual(service.model, 'option-model');
      } finally {
        restoreEnv('GOOGLE_API_KEY', originalKey);
        restoreEnv('GEMINI_MODEL', originalModel);
      }
    });

    it('throws GeminiServiceError when no API key or client is available', () => {
      const originalKey = process.env.GOOGLE_API_KEY;

      try {
        delete process.env.GOOGLE_API_KEY;
        assert.throws(() => new GeminiService(), GeminiServiceError);
      } finally {
        restoreEnv('GOOGLE_API_KEY', originalKey);
      }
    });

    it('validates prompt argument is a non-empty string', async () => {
      const service = new GeminiService({
        client: /** @type {any} */ ({ models: { generateContent: async () => ({ text: 'ok' }) } }),
        model: 'mock-model',
      });

      await assert.rejects(service.generateText(''), GeminiServiceError);
      await assert.rejects(service.generateText(/** @type {any} */ (null)), GeminiServiceError);
    });

    it('wraps API errors in GeminiServiceError', async () => {
      const mockClient = /** @type {any} */ ({
        models: {
          generateContent: async () => {
            throw new Error('API Rate Limit Exceeded');
          },
        },
      });

      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      await assert.rejects(
        service.generateText('Fail me'),
        (error) =>
          error instanceof GeminiServiceError &&
          error.message === 'Failed to generate Gemini response.' &&
          error.cause instanceof Error &&
          error.cause.message === 'API Rate Limit Exceeded',
      );
    });

    it('throws GeminiServiceError when Gemini returns empty text', async () => {
      const mockClient = /** @type {any} */ ({
        models: {
          generateContent: async () => ({ text: '   ' }),
        },
      });

      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      await assert.rejects(service.generateText('Empty response'), /Gemini returned an empty response/);
    });

    it('lets Gemini request an MCP tool and generates a final answer', async () => {
      const generateContentCalls = [];
      const mockClient = createSequentialGeminiClient(
        [
          { functionCalls: [{ name: 'search_commitments', args: { query: 'authentication' } }] },
          { text: 'I found one authentication commitment.' },
        ],
        generateContentCalls,
      );
      const mcpCalls = [];
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Find authentication commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async (request) => {
            mcpCalls.push(request);
            return {
              ok: true,
              result: [
                {
                  title: "I'll complete the login API by Friday",
                  status: 'Completed',
                  assignee: 'U0ABCDE123',
                  createdAt: '2026-07-01 07:12:35',
                  updatedAt: '2026-07-01 07:13:45',
                  githubIssue: '12',
                },
              ],
            };
          },
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'I found 1 commitments related to authentication:',
          '',
          " *Title:* I'll complete the login API by Friday. *Status:* Completed. *Assignee:* <@U0ABCDE123>. *Created At:* 2026-07-01. *Updated At:* 2026-07-01. *GitHub Issue:* #12.",
        ].join('\n'),
      );
      assert.deepStrictEqual(mcpCalls, [
        {
          toolName: 'search_commitments',
          input: { query: 'authentication' },
        },
      ]);
      assert.strictEqual(response.toolCalls.length, 1);
      assert.strictEqual(response.toolCalls[0].response.ok, true);
      assert.strictEqual(generateContentCalls[0].config.tools[0].functionDeclarations[0].name, 'search_commitments');
      assert.match(generateContentCalls[0].config.systemInstruction, /Do not use bullets, numbering, emojis, JSON/);
      assert.match(
        generateContentCalls[0].config.systemInstruction,
        /Render each commitment as exactly one paragraph with every field on the same line/,
      );
      assert.match(
        generateContentCalls[0].config.systemInstruction,
        /Title:, Status:, Assignee:, Created At:, Updated At:, GitHub Issue:/,
      );
      assert.match(generateContentCalls[0].config.systemInstruction, /Use each provided status exactly/);
      assert.match(
        generateContentCalls[0].config.systemInstruction,
        /If assignee is missing, omit the Assignee field entirely/,
      );
      assert.match(generateContentCalls[0].config.systemInstruction, /format it as a mention: <@U123ABC45>/);
      assert.match(generateContentCalls[0].config.systemInstruction, /GitHub Issue: #12/);
      assert.match(generateContentCalls[0].config.systemInstruction, /I couldn't find any commitments related to/);
      assert.deepStrictEqual(generateContentCalls[1].contents.at(-1), {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'search_commitments',
              response: {
                output: [
                  {
                    title: "I'll complete the login API by Friday",
                    status: 'Completed',
                    assignee: 'U0ABCDE123',
                    createdAt: '2026-07-01 07:12:35',
                    updatedAt: '2026-07-01 07:13:45',
                    githubIssue: '12',
                  },
                ],
              },
            },
          },
        ],
      });
    });

    it('returns a normal final answer when Gemini does not request a tool', async () => {
      const generateContentCalls = [];
      const mockClient = createSequentialGeminiClient([{ text: 'No tool needed.' }], generateContentCalls);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Say hello', {
        mcpServer: createMockMcpServer(),
      });

      assert.strictEqual(response.text, 'No tool needed.');
      assert.deepStrictEqual(response.toolCalls, []);
      assert.strictEqual(generateContentCalls.length, 1);
    });

    it('omits the assignee line when the tool result has no assignee', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'login' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Find login commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: "I'll finish the login API by Friday",
                status: 'Open',
                createdAt: '2026-07-01 07:17:59',
                updatedAt: '2026-07-01 07:17:59',
                githubIssue: '13',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'I found 1 commitments related to login:',
          '',
          " *Title:* I'll finish the login API by Friday. *Status:* Open. *Created At:* 2026-07-01. *Updated At:* 2026-07-01. *GitHub Issue:* #13.",
        ].join('\n'),
      );
      assert.doesNotMatch(response.text, /Assignee:/);
    });

    it('formats search results when Gemini returns empty final text after a successful tool call', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'login' } }] },
        { text: '   ' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Search commitments related to login', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: "I'll complete the login API by Friday.",
                status: 'Completed',
                assignee: 'U0ABCDE123',
                createdAt: '2026-07-01 07:12:35',
                updatedAt: '2026-07-01 07:12:35',
                githubIssue: '12',
              },
              {
                title: "I'll finish the login API by Friday",
                status: 'Open',
                assignee: '<@U0ABCDE123>',
                createdAt: '2026-07-01 07:13:45',
                updatedAt: '2026-07-01 07:13:45',
                githubIssue: 'GitHub Issue #13',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'I found 2 commitments related to login:',
          '',
          " *Title:* I'll complete the login API by Friday. *Status:* Completed. *Assignee:* <@U0ABCDE123>. *Created At:* 2026-07-01. *Updated At:* 2026-07-01. *GitHub Issue:* #12.",
          '',
          " *Title:* I'll finish the login API by Friday. *Status:* Open. *Assignee:* <@U0ABCDE123>. *Created At:* 2026-07-01. *Updated At:* 2026-07-01. *GitHub Issue:* #13.",
        ].join('\n'),
      );
    });

    it('formats search results on runtimes without Array.prototype.findLast', async () => {
      const originalFindLast = Array.prototype.findLast;
      Array.prototype.findLast = undefined;

      try {
        const mockClient = createSequentialGeminiClient([
          { functionCalls: [{ name: 'search_commitments', args: { query: 'API' } }] },
          { text: 'ignored because formatting is deterministic' },
        ]);
        const service = new GeminiService({ client: mockClient, model: 'mock-model' });

        const response = await service.generateTextWithTools('Search commitments related to API', {
          mcpServer: createMockMcpServer({
            handleToolRequest: async () => ({
              ok: true,
              result: [
                {
                  title: "I'll complete the API by Friday",
                  status: 'In Progress',
                  assignee: 'U0ABCDE123',
                  createdAt: '2026-07-01 07:12:35',
                  updatedAt: '2026-07-01 07:13:45',
                  githubIssue: '14',
                },
              ],
            }),
          }),
        });

        assert.strictEqual(
          response.text,
          [
            'I found 1 commitments related to API:',
            '',
            " *Title:* I'll complete the API by Friday. *Status:* In Progress. *Assignee:* <@U0ABCDE123>. *Created At:* 2026-07-01. *Updated At:* 2026-07-01. *GitHub Issue:* #14.",
          ].join('\n'),
        );
      } finally {
        Array.prototype.findLast = originalFindLast;
      }
    });

    it('passes MCP validation failures back to Gemini for the final answer', async () => {
      const generateContentCalls = [];
      const mockClient = createSequentialGeminiClient(
        [
          { functionCalls: [{ name: 'search_commitments', args: { query: '' } }] },
          { text: 'I could not search because the input was invalid.' },
        ],
        generateContentCalls,
      );
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Find commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: false,
            error: {
              code: 'ValidationError',
              message: "I couldn't complete that request because some details were invalid.",
            },
          }),
        }),
      });

      assert.strictEqual(response.text, 'I could not search because the input was invalid.');
      assert.strictEqual(response.toolCalls[0].response.ok, false);
      assert.strictEqual(response.toolCalls[0].response.error.code, 'ValidationError');
      assert.deepStrictEqual(generateContentCalls[1].contents.at(-1).parts[0].functionResponse.response, {
        error: {
          code: 'ValidationError',
          message: "I couldn't complete that request because some details were invalid.",
        },
      });
    });

    it('passes MCP execution failures back to Gemini for the final answer', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'authentication' } }] },
        { text: 'The search failed, so I cannot answer from commitments right now.' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Find commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: false,
            error: {
              code: 'ExecutionError',
              message: 'Storage unavailable.',
            },
          }),
        }),
      });

      assert.strictEqual(response.text, 'The search failed, so I cannot answer from commitments right now.');
      assert.strictEqual(response.toolCalls[0].response.error.code, 'ExecutionError');
    });

    it('handles Gemini requesting an unknown tool through MCP', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'unknown_tool', args: {} }] },
        { text: 'That tool is not available.' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Use a missing tool', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: false,
            error: {
              code: 'ToolNotFound',
              message: "I couldn't run that action because it is not available.",
            },
          }),
        }),
      });

      assert.strictEqual(response.text, 'That tool is not available.');
      assert.strictEqual(response.toolCalls[0].name, 'unknown_tool');
      assert.strictEqual(response.toolCalls[0].response.error.code, 'ToolNotFound');
    });

    it('supports multiple tool-calling iterations before the final answer', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'authentication' } }] },
        { functionCalls: [{ name: 'search_commitments', args: { query: 'api' } }] },
        { text: 'I found matching authentication and API commitments.' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Find related commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [],
          }),
        }),
      });

      assert.strictEqual(response.text, 'I found matching authentication and API commitments.');
      assert.deepStrictEqual(
        response.toolCalls.map((toolCall) => toolCall.args),
        [{ query: 'authentication' }, { query: 'api' }],
      );
    });

    it('preserves conversation history in tool-calling mode', async () => {
      const generateContentCalls = [];
      const mockClient = createSequentialGeminiClient([{ text: 'Continuing from history.' }], generateContentCalls);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });
      const history = [
        {
          role: 'user',
          parts: [{ text: 'Earlier question' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Earlier answer' }],
        },
      ];

      const response = await service.generateTextWithTools('Follow up', {
        history,
        mcpServer: createMockMcpServer(),
      });

      assert.deepStrictEqual(generateContentCalls[0].contents.slice(0, 2), history);
      assert.strictEqual(response.history[0], history[0]);
      assert.strictEqual(response.history.at(-1).parts[0].text, 'Continuing from history.');
    });

    it('logs Gemini tool-calling lifecycle events', async () => {
      const logs = [];
      const logger = createCollectingLogger(logs);
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'authentication' } }] },
        { text: 'Done.' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      await service.generateTextWithTools('Find commitments', {
        logger,
        mcpServer: createMockMcpServer(),
      });

      assert.ok(logs.some((log) => log.message === 'Gemini requested MCP tool'));
      assert.ok(logs.some((log) => log.message === 'MCP tool execution started'));
      assert.ok(logs.some((log) => log.message === 'MCP tool execution finished'));
      assert.ok(logs.some((log) => log.message === 'Gemini final response generated'));
    });
  });

  describe('getDefaultGeminiService', () => {
    it('lazily initializes and returns the same default instance', () => {
      const originalKey = process.env.GOOGLE_API_KEY;
      const originalModel = process.env.GEMINI_MODEL;

      try {
        process.env.GOOGLE_API_KEY = 'env-api-key';
        process.env.GEMINI_MODEL = 'env-model';

        const service1 = getDefaultGeminiService();
        const service2 = getDefaultGeminiService();

        assert.ok(service1 instanceof GeminiService);
        assert.strictEqual(service1, service2);
      } finally {
        restoreEnv('GOOGLE_API_KEY', originalKey);
        restoreEnv('GEMINI_MODEL', originalModel);
      }
    });
  });

  describe('generateResponse', () => {
    it('delegates to the lazily initialized default service', async () => {
      const originalKey = process.env.GOOGLE_API_KEY;
      const originalModel = process.env.GEMINI_MODEL;

      try {
        process.env.GOOGLE_API_KEY = 'env-api-key';
        process.env.GEMINI_MODEL = 'env-model';

        await assert.rejects(generateResponse(''), GeminiServiceError);
      } finally {
        restoreEnv('GOOGLE_API_KEY', originalKey);
        restoreEnv('GEMINI_MODEL', originalModel);
      }
    });
  });
});

/**
 * @param {string} name
 * @param {string | undefined} value
 */
function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

/**
 * @param {Array<{ text?: string, functionCalls?: Array<{ name?: string, args?: Record<string, unknown> }> }>} responses
 * @param {Array<Record<string, unknown>>} [calls]
 * @returns {any}
 */
function createSequentialGeminiClient(responses, calls = []) {
  return /** @type {any} */ ({
    models: {
      generateContent: async (params) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        const response = responses.shift();

        if (!response) {
          throw new Error('Unexpected Gemini call');
        }

        return response;
      },
    },
  });
}

/**
 * @param {{ handleToolRequest?: (request: { toolName: string, input: unknown }) => Promise<unknown> }} [overrides]
 * @returns {any}
 */
function createMockMcpServer(overrides = {}) {
  return {
    listTools: () => [
      {
        name: 'search_commitments',
        description: 'Search Anchor commitments.',
        version: '1.0.0',
        category: 'commitments',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        exampleInput: { query: 'authentication' },
        exampleOutput: [],
      },
    ],
    handleToolRequest:
      overrides.handleToolRequest ??
      (async () => ({
        ok: true,
        result: [],
      })),
  };
}

/**
 * @param {Array<{ level: string, message: string, context?: Record<string, unknown> }>} logs
 * @returns {import('../../mcp/logger.js').McpLogger}
 */
function createCollectingLogger(logs) {
  return {
    debug: (message, context) => logs.push({ level: 'debug', message, context }),
    info: (message, context) => logs.push({ level: 'info', message, context }),
    warn: (message, context) => logs.push({ level: 'warn', message, context }),
    error: (message, context) => logs.push({ level: 'error', message, context }),
  };
}
