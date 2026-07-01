import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash';

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
 * Reusable Gemini text-generation service.
 *
 * This service intentionally has no Slack, GitHub, SQLite, or MCP coupling.
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
 * introducing Slack, GitHub, SQLite, or agent orchestration dependencies.
 *
 * @param {string} prompt - User prompt to send to Gemini.
 * @param {GenerateTextOptions} [options] - Optional generation settings.
 * @returns {Promise<string>} Generated plain text.
 */
export async function generateResponse(prompt, options = {}) {
  return getDefaultGeminiService().generateText(prompt, options);
}

export default GeminiService;
