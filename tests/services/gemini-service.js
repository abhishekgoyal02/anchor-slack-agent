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
          "• **Title:** I'll complete the login API by Friday. **Status:** ✅ Completed. **Assignee:** <@U0ABCDE123>. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #12.",
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
      assert.match(generateContentCalls[0].config.systemInstruction, /metadata-line search style/);
      assert.match(generateContentCalls[0].config.systemInstruction, /grouped ownership style/);
      assert.match(generateContentCalls[0].config.systemInstruction, /Do not mix metadata-line search formatting/);
      assert.match(
        generateContentCalls[0].config.systemInstruction,
        /render one bullet per commitment with every field on the same line/,
      );
      assert.match(
        generateContentCalls[0].config.systemInstruction,
        /\*\*Title:\*\*, \*\*Status:\*\*, \*\*Assignee:\*\*, \*\*Created At:\*\*, \*\*Updated At:\*\*, \*\*GitHub Issue:\*\*/,
      );
      assert.match(generateContentCalls[0].config.systemInstruction, /Use each provided status exactly/);
      assert.match(
        generateContentCalls[0].config.systemInstruction,
        /If assignee is missing, omit the Assignee field entirely/,
      );
      assert.match(generateContentCalls[0].config.systemInstruction, /format it as a mention: <@U123ABC45>/);
      assert.match(generateContentCalls[0].config.systemInstruction, /GitHub Issue: #12/);
      assert.match(generateContentCalls[0].config.systemInstruction, /Nothing on \*\*<topic>\*\*/);
      assert.match(generateContentCalls[0].config.systemInstruction, /No commitments found for \*\*<topic>\*\*/);
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

    it('preserves Gemini function call ids when returning MCP tool responses', async () => {
      const generateContentCalls = [];
      const mockClient = createSequentialGeminiClient(
        [
          { functionCalls: [{ id: 'call-search-1', name: 'search_commitments', args: { query: 'authentication' } }] },
          { text: 'ignored because formatting is deterministic' },
        ],
        generateContentCalls,
      );
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      await service.generateTextWithTools('Search commitment related to Authentication.', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Authentication cleanup',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.deepStrictEqual(generateContentCalls[1].contents.at(-1), {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call-search-1',
              name: 'search_commitments',
              response: {
                output: [
                  {
                    title: 'Authentication cleanup',
                    status: 'Open',
                    assignee: 'Abhishek',
                    createdAt: '2026-07-07 09:00:00',
                    updatedAt: '2026-07-08 10:30:00',
                    githubIssue: '20',
                  },
                ],
              },
            },
          },
        ],
      });
    });

    it('preserves Gemini function call thought signatures in the model turn', async () => {
      const generateContentCalls = [];
      const mockClient = createSequentialGeminiClient(
        [
          {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      thoughtSignature: 'thought-signature-1',
                      functionCall: {
                        id: 'call-search-1',
                        name: 'search_commitments',
                        args: { query: 'authentication' },
                      },
                    },
                  ],
                },
              },
            ],
            functionCalls: [{ id: 'call-search-1', name: 'search_commitments', args: { query: 'authentication' } }],
          },
          { text: 'ignored because formatting is deterministic' },
        ],
        generateContentCalls,
      );
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      await service.generateTextWithTools('Search commitment related to authentication', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Authentication cleanup',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.deepStrictEqual(generateContentCalls[1].contents.at(-2), {
        role: 'model',
        parts: [
          {
            thoughtSignature: 'thought-signature-1',
            functionCall: {
              id: 'call-search-1',
              name: 'search_commitments',
              args: { query: 'authentication' },
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
          "• **Title:** I'll finish the login API by Friday. **Status:** 🟡 Open. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #13.",
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
          "• **Title:** I'll complete the login API by Friday. **Status:** ✅ Completed. **Assignee:** <@U0ABCDE123>. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #12.",
          '',
          "• **Title:** I'll finish the login API by Friday. **Status:** 🟡 Open. **Assignee:** <@U0ABCDE123>. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #13.",
        ].join('\n'),
      );
    });

    it('uses only approved randomized empty topic search messages', async () => {
      const originalRandom = Math.random;

      try {
        Math.random = () => 0;
        const firstService = new GeminiService({
          client: createSequentialGeminiClient([
            { functionCalls: [{ name: 'search_commitments', args: { query: 'AWS' } }] },
            { text: 'ignored because formatting is deterministic' },
          ]),
          model: 'mock-model',
        });
        const first = await firstService.generateTextWithTools('Search commitments related to AWS', {
          mcpServer: createMockMcpServer({
            handleToolRequest: async () => ({ ok: true, result: [] }),
          }),
        });

        Math.random = () => 0.99;
        const secondService = new GeminiService({
          client: createSequentialGeminiClient([
            { functionCalls: [{ name: 'search_commitments', args: { query: 'AWS' } }] },
            { text: 'ignored because formatting is deterministic' },
          ]),
          model: 'mock-model',
        });
        const second = await secondService.generateTextWithTools('Search commitments related to AWS', {
          mcpServer: createMockMcpServer({
            handleToolRequest: async () => ({ ok: true, result: [] }),
          }),
        });

        assert.strictEqual(first.text, '🐿 Nothing on **AWS** right now. Looks like nobody has picked it up yet.');
        assert.strictEqual(second.text, "🐧 No commitments found for **AWS**. Guess this one's still waiting for its first owner.");
      } finally {
        Math.random = originalRandom;
      }
    });

    it('does not render Context Snapshot fields in Ask Anchor search results', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'authentication' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Find authentication commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: [
                  "I'll migrate authentication to OAuth 2.0 this weekend",
                  '',
                  'Need to:',
                  '- update JWT validation',
                  '- replace refresh tokens',
                  '- update docs',
                  '- verify login flow',
                ].join('\n'),
                status: 'Completed',
                assignee: 'Workspace User',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
                summary: 'Authentication migration work',
                requirements: ['update JWT validation'],
                need_to: ['replace refresh tokens'],
                dependencies: ['auth service'],
                risk: 'Token regression',
                complexity: 'medium',
                labels: ['authentication'],
                generated_context: 'Context Snapshot content',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'I found 1 commitments related to authentication:',
          '',
          "• **Title:** I'll migrate authentication to OAuth 2.0 this weekend. **Status:** ✅ Completed. **Assignee:** Workspace User. **Created At:** 2026-07-07. **Updated At:** 2026-07-08. **GitHub Issue:** #20.",
        ].join('\n'),
      );
      assert.doesNotMatch(response.text, /Need to:/);
      assert.doesNotMatch(response.text, /Requirements/i);
      assert.doesNotMatch(response.text, /Summary/i);
      assert.doesNotMatch(response.text, /Dependencies/i);
      assert.doesNotMatch(response.text, /Context Snapshot/i);
      assert.doesNotMatch(response.text, /update JWT validation/);
      assert.doesNotMatch(response.text, /replace refresh tokens/);
    });

    it('formats ownership answers grouped by assignee', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Who is working on authentication?' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Who is working on authentication?', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Fix Google Authentication before Friday',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-01 07:12:35',
                updatedAt: '2026-07-01 07:12:35',
                githubIssue: '12',
              },
              {
                title: 'OAuth hardening',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-02 07:12:35',
                updatedAt: '2026-07-02 07:12:35',
                githubIssue: '14',
              },
              {
                title: 'OAuth migration',
                status: 'Completed',
                assignee: 'Alice',
                createdAt: '2026-07-02 07:12:35',
                updatedAt: '2026-07-03 07:12:35',
                githubIssue: '13',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          "👥 Here's who is working on authentication:",
          '',
          '• Abhishek',
          '  - Fix Google Authentication before Friday (Open)',
          '  - OAuth hardening (Open)',
          '',
          '• Alice',
          '  - OAuth migration (Completed)',
        ].join('\n'),
      );
      assert.doesNotMatch(response.text, /GitHub Issue|Created At|Updated At|https?:\/\//);
    });

    it('uses the original prompt to keep ownership UX when Gemini searches only the topic', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'authentication' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Who is working on authentication?', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Fix Google Authentication before Friday',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-01 07:12:35',
                updatedAt: '2026-07-01 07:12:35',
                githubIssue: '12',
              },
              {
                title: 'OAuth hardening',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-02 07:12:35',
                updatedAt: '2026-07-02 07:12:35',
                githubIssue: '14',
              },
              {
                title: 'OAuth migration',
                status: 'Completed',
                assignee: 'Alice',
                createdAt: '2026-07-02 07:12:35',
                updatedAt: '2026-07-03 07:12:35',
                githubIssue: '13',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          "👥 Here's who is working on authentication:",
          '',
          '• Abhishek',
          '  - Fix Google Authentication before Friday (Open)',
          '  - OAuth hardening (Open)',
          '',
          '• Alice',
          '  - OAuth migration (Completed)',
        ].join('\n'),
      );
      assert.doesNotMatch(response.text, /\*\*Title:\*\*|Created At|Updated At|GitHub Issue/);
    });

    it('keeps search authentication in metadata-line UX instead of ownership grouping', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Search authentication' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Search authentication', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Fix Google Authentication before Friday',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-01 07:12:35',
                updatedAt: '2026-07-01 07:12:35',
                githubIssue: '12',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'I found 1 commitments related to authentication:',
          '',
          '• **Title:** Fix Google Authentication before Friday. **Status:** 🟡 Open. **Assignee:** Abhishek. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #12.',
        ].join('\n'),
      );
      assert.match(response.text, /\*\*Title:\*\*/);
      assert.match(response.text, /\*\*GitHub Issue:\*\*/);
      assert.doesNotMatch(response.text, /👥 Here's who is working on/);
    });

    it('answers the production Authentication search phrase without falling back to a generic error', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ id: 'auth-call', name: 'search_commitments', args: { query: 'Authentication' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Search commitment related to Authentication.', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Authentication rollout',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.match(response.text, /^I found 1 commitments related to Authentication:/);
      assert.match(response.text, /\*\*Title:\*\* Authentication rollout\./);
      assert.doesNotMatch(response.text, /Something went wrong|Context Snapshot|Requirements|Summary/);
    });

    it('answers the incident commitment-query phrases without generic fallback text', async () => {
      const cases = [
        {
          prompt: 'show open commitments',
          toolQuery: 'show open commitments',
          result: {
            title: 'Open authentication cleanup',
            status: 'Open',
            assignee: 'Abhishek',
            createdAt: '2026-07-07 09:00:00',
            updatedAt: '2026-07-08 10:30:00',
            githubIssue: '20',
          },
          expected: /^Open commitments:\n\n• \*\*Title:\*\* Open authentication cleanup\./,
        },
        {
          prompt: 'search commitment related to API',
          toolQuery: 'API',
          result: {
            title: 'API migration',
            status: 'Open',
            assignee: 'Abhishek',
            createdAt: '2026-07-07 09:00:00',
            updatedAt: '2026-07-08 10:30:00',
            githubIssue: '21',
          },
          expected: /^I found 1 commitments related to API:\n\n• \*\*Title:\*\* API migration\./,
        },
        {
          prompt: 'search commitment related to authentication',
          toolQuery: 'authentication',
          result: {
            title: 'Authentication rollout',
            status: 'Open',
            assignee: 'Abhishek',
            createdAt: '2026-07-07 09:00:00',
            updatedAt: '2026-07-08 10:30:00',
            githubIssue: '22',
          },
          expected: /^I found 1 commitments related to authentication:\n\n• \*\*Title:\*\* Authentication rollout\./,
        },
        {
          prompt: 'who is working on authentication?',
          toolQuery: 'authentication',
          result: {
            title: 'Authentication hardening',
            status: 'Open',
            assignee: 'Abhishek',
            createdAt: '2026-07-07 09:00:00',
            updatedAt: '2026-07-08 10:30:00',
            githubIssue: '23',
          },
          expected: /^👥 Here's who is working on authentication:\n\n• Abhishek\n  - Authentication hardening \(Open\)$/,
        },
      ];

      for (const testCase of cases) {
        const service = new GeminiService({
          client: createSequentialGeminiClient([
            {
              functionCalls: [
                {
                  id: `${testCase.toolQuery.replace(/\s+/g, '-').toLowerCase()}-call`,
                  name: 'search_commitments',
                  args: { query: testCase.toolQuery },
                },
              ],
            },
            { text: 'ignored because formatting is deterministic' },
          ]),
          model: 'mock-model',
        });

        const response = await service.generateTextWithTools(testCase.prompt, {
          mcpServer: createMockMcpServer({
            handleToolRequest: async () => ({
              ok: true,
              result: [testCase.result],
            }),
          }),
        });

        assert.match(response.text, testCase.expected);
        assert.doesNotMatch(response.text, /Something went wrong|Context Snapshot|Requirements|Summary/);
      }
    });

    it('keeps Search API and Search login in metadata-line UX with separate topics', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Search API' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Search API', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Document public API usage',
                status: 'Open',
                assignee: 'Alice',
                createdAt: '2026-07-01 07:12:35',
                updatedAt: '2026-07-01 07:12:35',
                githubIssue: '12',
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
          '• **Title:** Document public API usage. **Status:** 🟡 Open. **Assignee:** Alice. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #12.',
        ].join('\n'),
      );
      assert.doesNotMatch(response.text, /👥 Here's who is working on|Fix Google Authentication/);
    });

    it('keeps Search deployment in metadata-line UX', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Search deployment' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Search deployment', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Production deployment checklist',
                status: 'Open',
                assignee: 'Workspace User',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.match(response.text, /^I found 1 commitments related to deployment:/);
      assert.match(response.text, /\*\*Title:\*\* Production deployment checklist\./);
      assert.doesNotMatch(response.text, /👥 Here's who is working on/);
    });

    it('keeps responsible-for questions in grouped ownership UX', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Who is responsible for deployment?' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Who is responsible for deployment?', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Production deployment checklist',
                status: 'Open',
                assignee: 'Workspace User',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        ["👥 Here's who is working on deployment:", '', '• Workspace User', '  - Production deployment checklist (Open)'].join('\n'),
      );
      assert.doesNotMatch(response.text, /\*\*Title:\*\*|Created At|Updated At|GitHub Issue/);
    });

    it('keeps who-owns and handling questions in grouped ownership UX', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Who owns OAuth?' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Who owns OAuth?', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'OAuth migration',
                status: 'Completed',
                assignee: 'Alice',
                createdAt: '2026-07-02 07:12:35',
                updatedAt: '2026-07-03 07:12:35',
                githubIssue: '13',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(response.text, ["👥 Here's who is working on OAuth:", '', '• Alice', '  - OAuth migration (Completed)'].join('\n'));
      assert.doesNotMatch(response.text, /\*\*Title:\*\*|Created At|Updated At|GitHub Issue/);
    });

    it('keeps who-is-handling login in grouped ownership UX', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Who is handling login?' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Who is handling login?', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Fix login redirect',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-02 07:12:35',
                updatedAt: '2026-07-03 07:12:35',
                githubIssue: '13',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(response.text, ["👥 Here's who is working on login:", '', '• Abhishek', '  - Fix login redirect (Open)'].join('\n'));
      assert.doesNotMatch(response.text, /\*\*Title:\*\*|Created At|Updated At|GitHub Issue/);
    });

    it('formats status queries with the preserved metadata-line UX', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Show open commitments' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Show open commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Production deployment checklist',
                status: 'Open',
                assignee: 'Workspace User',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'Open commitments:',
          '',
          '• **Title:** Production deployment checklist. **Status:** 🟡 Open. **Assignee:** Workspace User. **Created At:** 2026-07-07. **Updated At:** 2026-07-08. **GitHub Issue:** #20.',
        ].join('\n'),
      );
      assert.match(response.text, /\*\*Title:\*\*/);
      assert.match(response.text, /\*\*Status:\*\*/);
      assert.match(response.text, /\*\*Assignee:\*\*/);
      assert.match(response.text, /\*\*Created At:\*\*/);
      assert.match(response.text, /\*\*Updated At:\*\*/);
      assert.match(response.text, /\*\*GitHub Issue:\*\*/);
    });

    it('renders every open commitment returned by MCP', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: 'Show open commitments' } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools('Show Open Commitments', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: Array.from({ length: 6 }, (_, index) => ({
              title: `Open commitment ${index + 1}`,
              status: index === 2 ? 'In Progress' : 'Open',
              assignee: 'Alice',
              createdAt: '2026-07-07 09:00:00',
              updatedAt: '2026-07-08 10:30:00',
              githubIssue: String(20 + index),
            })),
          }),
        }),
      });

      assert.match(response.text, /^Open commitments:/);
      assert.strictEqual(response.text.match(/\*\*Title:\*\*/g)?.length, 6);
      assert.match(response.text, /Open commitment 6/);
      assert.doesNotMatch(response.text, /👥 Here's who is working on/);
    });

    it('formats completed, overdue, and today status queries with metadata-line UX', async () => {
      const service = new GeminiService({
        client: createSequentialGeminiClient([
          { functionCalls: [{ name: 'search_commitments', args: { query: 'Show completed commitments' } }] },
          { text: 'ignored because formatting is deterministic' },
          { functionCalls: [{ name: 'search_commitments', args: { query: 'Show overdue work' } }] },
          { text: 'ignored because formatting is deterministic' },
          { functionCalls: [{ name: 'search_commitments', args: { query: 'Show todays commitments' } }] },
          { text: 'ignored because formatting is deterministic' },
        ]),
        model: 'mock-model',
      });
      const mcpServer = createMockMcpServer({
        handleToolRequest: async (request) => ({
          ok: true,
          result: [
            {
              title: String(request.input.query),
              status: request.input.query.includes('completed') ? 'Completed' : 'Open',
              assignee: 'Alice',
              createdAt: '2026-07-07 09:00:00',
              updatedAt: '2026-07-08 10:30:00',
              githubIssue: '20',
            },
          ],
        }),
      });

      const completed = await service.generateTextWithTools('Show completed commitments', { mcpServer });
      const overdue = await service.generateTextWithTools('Show overdue work', { mcpServer });
      const today = await service.generateTextWithTools('Show todays commitments', { mcpServer });

      assert.match(completed.text, /^Completed commitments:\n\n• \*\*Title:\*\*/);
      assert.match(overdue.text, /^Overdue commitments:\n\n• \*\*Title:\*\*/);
      assert.match(today.text, /^Today's commitments:\n\n• \*\*Title:\*\*/);
      assert.doesNotMatch(overdue.text, /related to overdue/);
      assert.doesNotMatch([completed.text, overdue.text, today.text].join('\n'), /👥 Here's who is working on/);
    });

    it('returns the overdue empty-state instead of topic-search empty UX', async () => {
      const service = new GeminiService({
        client: createSequentialGeminiClient([
          { functionCalls: [{ name: 'search_commitments', args: { query: 'Show overdue work' } }] },
          { text: 'ignored because formatting is deterministic' },
        ]),
        model: 'mock-model',
      });

      const response = await service.generateTextWithTools('Show overdue work', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({ ok: true, result: [] }),
        }),
      });

      assert.strictEqual(response.text, "🦊 Good news — there isn't any overdue work right now.");
      assert.doesNotMatch(response.text, /related to overdue/i);
      assert.doesNotMatch(response.text, /Nothing on|No commitments found/);
    });

    it('falls back to direct commitment search when Gemini fails for overdue work', async () => {
      const service = new GeminiService({
        client: createThrowingGeminiClient(new Error('provider unavailable')),
        model: 'mock-model',
      });

      const response = await service.generateTextWithTools('Show overdue work', {
        mcpServer: createMockMcpServer({
          handleToolRequest: async (request) => ({
            ok: true,
            result: [
              {
                title: String(request.input.query),
                status: 'Open',
                assignee: 'Alice',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
            ],
          }),
        }),
      });

      assert.match(response.text, /^Overdue commitments:\n\n• \*\*Title:\*\* Show overdue work\./);
      assert.strictEqual(response.toolCalls[0].name, 'search_commitments');
      assert.deepStrictEqual(response.toolCalls[0].args, { query: 'Show overdue work' });
    });

    it('uses the direct commitment search fallback empty-state for missing topics', async () => {
      const originalRandom = Math.random;
      try {
        Math.random = () => 0;
        const service = new GeminiService({
          client: createThrowingGeminiClient(new Error('provider unavailable')),
          model: 'mock-model',
        });

        const response = await service.generateTextWithTools('Show commitment related to AWS or Kubernetes migration', {
          mcpServer: createMockMcpServer({
            handleToolRequest: async () => ({ ok: true, result: [] }),
          }),
        });

        assert.strictEqual(
          response.text,
          '🐿 Nothing on **AWS or Kubernetes migration** right now. Looks like nobody has picked it up yet.',
        );
      } finally {
        Math.random = originalRandom;
      }
    });

    it('formats release blocker answers without metadata dumps', async () => {
      const mockClient = createSequentialGeminiClient([
        { functionCalls: [{ name: 'search_commitments', args: { query: "What's blocking release?" } }] },
        { text: 'ignored because formatting is deterministic' },
      ]);
      const service = new GeminiService({ client: mockClient, model: 'mock-model' });

      const response = await service.generateTextWithTools("What's blocking release?", {
        mcpServer: createMockMcpServer({
          handleToolRequest: async () => ({
            ok: true,
            result: [
              {
                title: 'Fix Google Authentication before Friday',
                status: 'Open',
                assignee: 'Abhishek',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '20',
              },
              {
                title: 'API migration',
                status: 'In Progress',
                assignee: 'Alice',
                createdAt: '2026-07-07 09:00:00',
                updatedAt: '2026-07-08 10:30:00',
                githubIssue: '21',
                summary: 'Context Snapshot content',
                requirements: ['Do not show this'],
              },
            ],
          }),
        }),
      });

      assert.strictEqual(
        response.text,
        [
          'Potential release blockers:',
          '',
          'Abhishek',
          '  Fix Google Authentication before Friday',
          '',
          'Alice',
          '  API migration',
          '',
          '2 open commitments may impact the next release.',
        ].join('\n'),
      );
      assert.doesNotMatch(response.text, /Summary|Requirements|Context Snapshot|Created At|Updated At|GitHub Issue|https?:\/\/|\|/);
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
            "• **Title:** I'll complete the API by Friday. **Status:** 🔵 In Progress. **Assignee:** <@U0ABCDE123>. **Created At:** 2026-07-01. **Updated At:** 2026-07-01. **GitHub Issue:** #14.",
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
 * @param {Array<{ text?: string, candidates?: Array<Record<string, unknown>>, functionCalls?: Array<{ id?: string, name?: string, args?: Record<string, unknown> }> }>} responses
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
 * @param {Error} error
 * @returns {any}
 */
function createThrowingGeminiClient(error) {
  return {
    models: {
      generateContent: async () => {
        throw error;
      },
    },
  };
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
