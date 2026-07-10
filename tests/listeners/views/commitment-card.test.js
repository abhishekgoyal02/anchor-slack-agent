import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildCommitmentAlreadyTrackedCard,
  buildCommitmentCard,
  buildCommitmentCompletedCard,
  buildCommitmentConfirmedCard,
  buildCommitmentIgnoredCard,
} from '../../../listeners/views/commitment-card.js';

describe('commitment-card', () => {
  it('buildCommitmentCard creates a card with action buttons', () => {
    const blocks = buildCommitmentCard('test text', buildRealityCheck());
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, 'section');
    const lines = blocks[0].text.text.split('\n');
    assert.deepStrictEqual(lines, [
      '⚓ *Potential commitment detected*',
      'Fix Google Authentication before Friday',
      '>Ill fix Google Authentication before Friday.',
      'Due: Friday  Similar authentication work usually takes ~1 day.',
      'This looks very realistic.',
      '🐧 Low-key this timeline looks solid.',
    ]);
    assert.strictEqual(lines.length, 6);
    assert.strictEqual([...blocks[0].text.text.matchAll(/\p{Extended_Pictographic}/gu)].length, 2);
    assert.strictEqual([...lines[5].matchAll(/\p{Emoji_Presentation}/gu)].length, 1);
    assert.doesNotMatch(blocks[0].text.text, /Confidence:/);
    assert.strictEqual(blocks[1].type, 'actions');
    assert.strictEqual(blocks[1].elements.length, 2);
    assert.strictEqual(blocks[1].elements[0].action_id, 'commitment_confirm');
    assert.strictEqual(blocks[1].elements[0].text.text, 'Keep Friday');
    assert.strictEqual(blocks[1].elements[1].action_id, 'commitment_confirm_recommended');
    assert.strictEqual(blocks[1].elements[1].text.text, 'Use Thursday');
    assert.notStrictEqual(blocks[1].elements[0].action_id, blocks[1].elements[1].action_id);
    assert.ok(blocks[1].elements[0].value);
    assert.ok(blocks[1].elements[1].value);
  });

  it('buildCommitmentCard falls back for malformed Reality Check data', () => {
    const blocks = buildCommitmentCard('test text', null);

    assert.strictEqual(blocks[0].text.text.split('\n').length, 6);
    assert.match(blocks[0].text.text, /Potential commitment detected/);
    assert.strictEqual(blocks[1].elements[0].text.text, 'Keep Date');
    assert.strictEqual(blocks[1].elements[1].text.text, 'Proceed Anyway');
    assert.strictEqual(blocks[1].elements[0].value, 'Commitment detected.');
  });

  it('buildCommitmentConfirmedCard builds a card for confirmed commitments', () => {
    const blocks = buildCommitmentConfirmedCard('test text', { issueNumber: 123, issueUrl: 'http://url' });
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'section');
    assert.match(blocks[0].text.text, /Commitment Confirmed/);
    assert.match(blocks[0].text.text, /test text/);
    assert.match(blocks[0].text.text, /#123/);
    assert.match(blocks[0].text.text, /http:\/\/url/);
  });

  it('buildCommitmentConfirmedCard handles github errors gracefully', () => {
    const blocks = buildCommitmentConfirmedCard('test text', { githubError: true });
    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0].text.text, /could not be created/);
  });

  it('buildCommitmentAlreadyTrackedCard returns a warning card', () => {
    const blocks = buildCommitmentAlreadyTrackedCard('test text');
    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0].text.text, /Already Tracked/);
  });

  it('buildCommitmentIgnoredCard returns ignored card', () => {
    const blocks = buildCommitmentIgnoredCard('test text');
    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0].text.text, /Ignored/);
  });

  it('buildCommitmentCompletedCard returns completed card with issue details', () => {
    const blocks = buildCommitmentCompletedCard('test text', { issueNumber: 123, issueUrl: 'http://url' });
    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0].text.text, /Completed/);
    assert.match(blocks[0].text.text, /#123/);
  });
});

function buildRealityCheck(overrides = {}) {
  return {
    title: 'Fix Google Authentication before Friday',
    originalText: 'Ill fix Google Authentication before Friday.',
    dueDateLabel: 'Friday',
    predictedCompletionLabel: 'Thursday',
    similarCount: 6,
    analysisText: 'Similar authentication work usually takes ~1 day.',
    recommendationText: 'This looks very realistic.',
    microcopy: '🐧 Low-key this timeline looks solid.',
    primaryButtonLabel: 'Keep Friday',
    secondaryButtonLabel: 'Use Thursday',
    primaryValue: 'test text',
    secondaryValue: 'test text',
    ...overrides,
  };
}
