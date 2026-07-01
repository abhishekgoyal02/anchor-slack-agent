import assert from 'node:assert';
import { describe, it } from 'node:test';

import { detectCommitment } from '../../services/commitment-detector.js';

describe('detectCommitment', () => {
  it('detects concrete future commitments', () => {
    const examples = [
      "I'll finish the API tomorrow",
      "I'll do API documentation by Wednesday.",
      "I'll update the documentation",
      'I will review the PR',
      "I'll send the deck by Friday",
      "I'll complete the rollout today",
      "I'll prepare release notes tonight",
      "I'll document the webhook flow this evening",
      "I'll write the migration guide Monday",
      "I'll fix the auth bug before Monday",
      "I'll investigate the timeout within 2 days",
      "I'll research deployment options in two days",
      "I'll finish the changelog next week",
      "Let's deploy the fix tomorrow",
      'I can handle the migration',
      'Let me follow up with Design',
    ];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), true, example);
    }
  });

  it('rejects incomplete or uncertain statements', () => {
    const examples = ["I'll", 'I will', "maybe I'll", 'I might', 'I think', 'I hope', "maybe I'll update the docs"];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), false, example);
    }
  });

  it('requires a meaningful action and target after the starter', () => {
    const examples = [
      "I'll review",
      'I will update',
      "I'll update by Friday",
      "I'll finish tomorrow",
      "I'll investigate in two days",
      "let's deploy",
      'I can handle',
    ];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), false, example);
    }
  });

  it('ignores unrelated messages', () => {
    const examples = ['The API is almost done', 'Can someone review the PR?', 'Thanks for the update'];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), false, example);
    }
  });
});
