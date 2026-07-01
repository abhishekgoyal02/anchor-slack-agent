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
