import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  createContextSnapshot,
  createFallbackSnapshot,
  normalizeContextSnapshot,
} from '../../services/context-snapshot.js';

describe('context-snapshot', () => {
  it('creates a normalized snapshot from Gemini JSON', async () => {
    let prompt;
    let options;
    const snapshot = await createContextSnapshot("I'll fix authentication by Friday.", {
      geminiService: {
        generateText: async (receivedPrompt, receivedOptions) => {
          prompt = receivedPrompt;
          options = receivedOptions;
          return JSON.stringify({
            title: 'Fix Authentication API',
            summary: 'Resolve authentication timeout issues and update JWT validation.',
            requirements: ['Update JWT expiry logic', 'Add unit tests'],
            dueDate: 'Friday',
            assignee: 'Aparna',
            labels: 'Backend, API, Google Authentication, backend, Security, Extra Label',
            dependencies: ['JWT service', 'jwt service', 'Login endpoint'],
            potentialRisks: ['Authentication changes may affect login flow.'],
            confidence: 'High',
            estimatedComplexity: 'Very High',
          });
        },
      },
    });

    assert.match(prompt, /already-detected Slack commitment/);
    assert.match(prompt, /I'll fix authentication by Friday/);
    assert.strictEqual(options.temperature, 0.2);
    assert.match(options.systemInstruction, /Return JSON only/);
    assert.match(options.systemInstruction, /Potential risks/);
    assert.match(options.systemInstruction, /limited to five/);
    assert.deepStrictEqual(snapshot, {
      title: 'Fix Authentication API',
      summary: 'Resolve authentication timeout issues and update JWT validation.',
      requirements: ['Update JWT expiry logic', 'Add unit tests'],
      dueDate: 'Friday',
      assignee: 'Aparna',
      labels: ['backend', 'api', 'google-authentication', 'security', 'extra-label'],
      dependencies: ['JWT service', 'Login endpoint'],
      potentialRisks: ['Authentication changes may affect login flow.'],
      confidence: 'high',
      estimatedComplexity: 'very high',
    });
  });

  it('preserves multiline commitment formatting in the Gemini prompt', async () => {
    const commitment = [
      "I'll migrate authentication to OAuth 2.0 this weekend.",
      '',
      'Need to:',
      '- update JWT validation',
      '- replace refresh tokens',
      '- update documentation',
      '- verify login flow',
      '- write tests',
    ].join('\n');
    let prompt;

    await createContextSnapshot(commitment, {
      geminiService: {
        generateText: async (receivedPrompt) => {
          prompt = receivedPrompt;
          return JSON.stringify({
            title: 'Migrate Authentication to OAuth 2.0',
            summary:
              'Migrate the authentication flow to OAuth 2.0 this weekend and complete the related validation, documentation, login verification, and test updates.',
            requirements: [
              'Update JWT validation',
              'Replace refresh tokens',
              'Update documentation',
              'Verify login flow',
              'Write tests',
            ],
            dueDate: 'this weekend',
            assignee: '',
            labels: ['oauth', 'authentication', 'backend', 'security'],
            dependencies: ['OAuth Provider', 'JWT Module', 'Authentication Service'],
            potentialRisks: ['Authentication changes may affect login flow.'],
            confidence: 'high',
            estimatedComplexity: 'high',
          });
        },
      },
    });

    assert.match(prompt, /Need to:\n- update JWT validation\n- replace refresh tokens/);
  });

  it('falls back safely when Gemini returns invalid JSON', async () => {
    const warnings = [];
    const snapshot = await createContextSnapshot("I'll finish the API tomorrow.", {
      geminiService: {
        generateText: async () => 'not-json',
      },
      logger: {
        warn: (message) => warnings.push(message),
      },
    });

    assert.deepStrictEqual(snapshot, createFallbackSnapshot("I'll finish the API tomorrow."));
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /Context snapshot generation failed/);
  });

  it('normalizes invalid fields into consistent defaults', () => {
    const snapshot = normalizeContextSnapshot(
      {
        title: '',
        summary: '',
        requirements: null,
        labels: [' Backend ', 'backend', '', 'API'],
        dependencies: 'Auth service; Login endpoint',
        potentialRisks: '- Login behavior may regress.; Login behavior may regress.',
        confidence: 'certain',
        estimatedComplexity: 'unknown',
      },
      createFallbackSnapshot("We'll ship billing cleanup."),
    );

    assert.deepStrictEqual(snapshot, {
      title: 'Ship billing cleanup',
      summary: "We'll ship billing cleanup.",
      requirements: [],
      dueDate: '',
      assignee: '',
      labels: ['backend', 'api'],
      dependencies: ['Auth service', 'Login endpoint'],
      potentialRisks: ['Login behavior may regress.'],
      confidence: 'low',
      estimatedComplexity: 'medium',
    });
  });
});
