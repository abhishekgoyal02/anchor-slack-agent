import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  analyzeRealityCheck,
  createFallbackRealityCheck,
  getRandomRealityCheckMicrocopy,
  REALITY_CHECK_MICROCOPY,
} from '../../services/reality-check-service.js';

describe('reality-check-service', () => {
  it('extracts deadlines and compares similar historical commitments', async () => {
    const analysis = await analyzeRealityCheck("I'll fix Google Authentication before Friday.", {
      now: new Date('2026-07-06T09:00:00Z'),
      random: () => 0,
      store: {
        getAllCommitments: async () => [
          buildCommitment({
            text: "I'll fix authentication login by Friday.",
            created_at: '2026-06-30 09:00:00',
            completed_at: '2026-07-03 09:00:00',
          }),
          buildCommitment({
            text: "I'll migrate authentication to OAuth this weekend.",
            created_at: '2026-06-20 09:00:00',
            completed_at: '2026-06-23 09:00:00',
          }),
          buildCommitment({ text: "I'll update documentation tomorrow." }),
        ],
      },
    });

    assert.strictEqual(analysis.dueDateLabel, 'Friday');
    assert.strictEqual(analysis.predictedCompletionLabel, 'Thursday');
    assert.strictEqual(analysis.similarCount, 2);
    assert.strictEqual(analysis.title, 'Fix Google Authentication before Friday');
    assert.strictEqual(analysis.originalText, "I'll fix Google Authentication before Friday.");
    assert.strictEqual(analysis.analysisText, 'Similar authentication work usually takes ~3 days.');
    assert.strictEqual(analysis.recommendationText, 'This looks tight, but possible.');
    assert.strictEqual(analysis.primaryButtonLabel, 'Keep Friday');
    assert.strictEqual(analysis.secondaryButtonLabel, 'Use Thursday');
    assert.strictEqual(analysis.secondaryValue, "I'll fix Google Authentication before Thursday.");
  });

  it('uses recommendation-based proceed labels when the stated deadline looks reasonable', async () => {
    const analysis = await analyzeRealityCheck("I'll complete the API setup tomorrow.", {
      now: new Date('2026-07-06T09:00:00Z'),
      random: () => 0.99,
      store: { getAllCommitments: async () => [] },
    });

    assert.strictEqual(analysis.dueDateLabel, 'Tomorrow');
    assert.strictEqual(analysis.predictedCompletionLabel, 'Tomorrow');
    assert.strictEqual(analysis.primaryButtonLabel, 'Keep Tomorrow');
    assert.strictEqual(analysis.secondaryButtonLabel, 'Proceed Anyway');
    assert.strictEqual(analysis.primaryValue, "I'll complete the API setup tomorrow.");
    assert.strictEqual(analysis.secondaryValue, "I'll complete the API setup tomorrow.");
  });

  it('creates a complete fallback analysis for valid Slack commitment text', () => {
    const analysis = createFallbackRealityCheck("I'll fix Google Authentication before Friday.", { random: () => 0 });

    assert.strictEqual(analysis.title, 'Fix Google Authentication before Friday');
    assert.strictEqual(analysis.originalText, "I'll fix Google Authentication before Friday.");
    assert.strictEqual(analysis.dueDateLabel, 'Friday');
    assert.strictEqual(analysis.predictedCompletionLabel, 'Friday');
    assert.strictEqual(analysis.primaryButtonLabel, 'Keep Friday');
    assert.strictEqual(analysis.secondaryButtonLabel, 'Proceed Anyway');
    assert.strictEqual(analysis.primaryValue, "I'll fix Google Authentication before Friday.");
    assert.strictEqual(analysis.secondaryValue, "I'll fix Google Authentication before Friday.");
    assert.ok(analysis.analysisText);
    assert.ok(analysis.microcopy);
  });

  it('rotates among approved subtle microcopy variants', () => {
    assert.strictEqual(REALITY_CHECK_MICROCOPY.length, 10);
    assert.strictEqual(
      getRandomRealityCheckMicrocopy(() => 0),
      REALITY_CHECK_MICROCOPY[0],
    );
    assert.strictEqual(
      getRandomRealityCheckMicrocopy(() => 0.99),
      REALITY_CHECK_MICROCOPY[9],
    );

    for (const line of REALITY_CHECK_MICROCOPY) {
      assert.strictEqual(typeof line, 'string');
      assert.ok(line.length > 0);
      assert.match(line, /^\p{Emoji_Presentation}/u);
      assert.strictEqual([...line.matchAll(/\p{Emoji_Presentation}/gu)].length, 1);
      assert.doesNotMatch(line, /Confidence:/i);
    }
  });
});

function buildCommitment(overrides = {}) {
  return {
    id: 1,
    text: 'Historical commitment',
    user_id: 'UREAL',
    channel_id: 'CREAL',
    thread_ts: '1710000000.000100',
    message_ts: '1710000000.000100',
    status: 'completed',
    created_at: '2026-06-30 09:00:00',
    github_issue_number: null,
    github_issue_url: null,
    completed_at: null,
    ...overrides,
  };
}
