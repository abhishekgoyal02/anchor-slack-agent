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
    const blocks = buildCommitmentCard('test text');
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].type, 'section');
    assert.match(blocks[0].text.text, /test text/);
    assert.strictEqual(blocks[1].type, 'actions');
    assert.strictEqual(blocks[1].elements.length, 2);
    assert.strictEqual(blocks[1].elements[0].action_id, 'commitment_confirm');
    assert.strictEqual(blocks[1].elements[1].action_id, 'commitment_ignore');
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
