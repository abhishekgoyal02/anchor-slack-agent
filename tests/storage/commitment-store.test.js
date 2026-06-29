import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  getCommitmentById,
  getOpenCommitmentsWithGithubIssues,
  markCommitmentCompleted,
  saveCommitment,
  updateCommitmentGithubMetadata,
} from '../../storage/commitment-store.js';

describe('commitment-store', () => {
  it('saves a commitment and returns the inserted ID', async () => {
    const id = await saveCommitment({
      text: `Test commitment ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: `T-${Date.now()}`,
      messageTs: `M-${Date.now()}`,
    });

    assert.strictEqual(typeof id, 'number');
    assert.ok(id > 0);
  });

  it('updates GitHub metadata for a specific commitment row', async () => {
    const id = await saveCommitment({
      text: `Test GitHub metadata ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: `T-${Date.now()}`,
      messageTs: `M-${Date.now()}`,
    });

    const updated = await updateCommitmentGithubMetadata(id, {
      issueNumber: 12,
      issueUrl: 'https://github.com/owner/repo/issues/12',
    });
    const commitment = await getCommitmentById(id);

    assert.strictEqual(updated, true);
    assert.strictEqual(commitment.github_issue_number, 12);
    assert.strictEqual(commitment.github_issue_url, 'https://github.com/owner/repo/issues/12');
  });

  it('returns false when updating GitHub metadata for a missing row', async () => {
    const updated = await updateCommitmentGithubMetadata(-1, {
      issueNumber: 12,
      issueUrl: 'https://github.com/owner/repo/issues/12',
    });

    assert.strictEqual(updated, false);
  });

  it('loads only open commitments linked to GitHub issues', async () => {
    const linkedThreadTs = `T-linked-${Date.now()}`;
    const unlinkedThreadTs = `T-unlinked-${Date.now()}`;
    const linkedId = await saveCommitment({
      text: `Linked commitment ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: linkedThreadTs,
      messageTs: `M-linked-${Date.now()}`,
    });
    await saveCommitment({
      text: `Unlinked commitment ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: unlinkedThreadTs,
      messageTs: `M-unlinked-${Date.now()}`,
    });
    await updateCommitmentGithubMetadata(linkedId, {
      issueNumber: 99,
      issueUrl: 'https://github.com/owner/repo/issues/99',
    });

    const linkedCommitments = await getOpenCommitmentsWithGithubIssues();

    assert.ok(linkedCommitments.some((commitment) => commitment.id === linkedId));
    assert.ok(linkedCommitments.every((commitment) => commitment.github_issue_number !== null));
  });

  it('marks a commitment completed with completed_at', async () => {
    const id = await saveCommitment({
      text: `Completable commitment ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: `T-complete-${Date.now()}`,
      messageTs: `M-complete-${Date.now()}`,
    });

    const updated = await markCommitmentCompleted(id);
    const commitment = await getCommitmentById(id);

    assert.strictEqual(updated, true);
    assert.strictEqual(commitment.status, 'completed');
    assert.strictEqual(typeof commitment.completed_at, 'string');
    assert.ok(commitment.completed_at.length > 0);
  });

  it('returns false when completing a missing commitment', async () => {
    const updated = await markCommitmentCompleted(-1);

    assert.strictEqual(updated, false);
  });
});
