import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  getCommitmentById,
  getGithubSyncEligibleCommitments,
  getOpenCommitmentsWithGithubIssues,
  markCommitmentCompleted,
  recordGithubSyncFailure,
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

  it('clears GitHub sync quarantine when GitHub metadata is refreshed', async () => {
    const id = await saveCommitment({
      text: `Relinked commitment ${Date.now()}`,
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: `T-relinked-${Date.now()}`,
      messageTs: `M-relinked-${Date.now()}`,
    });
    await updateCommitmentGithubMetadata(id, {
      issueNumber: 12,
      issueUrl: 'https://github.com/owner/repo/issues/12',
    });
    const failure = await recordGithubSyncFailure(id, { reason: 'github_status_404', maxFailures: 1 });

    assert.strictEqual(failure.quarantined, true);

    await updateCommitmentGithubMetadata(id, {
      issueNumber: 13,
      issueUrl: 'https://github.com/owner/repo/issues/13',
    });
    const commitment = await getCommitmentById(id);

    assert.strictEqual(commitment.github_issue_number, 13);
    assert.strictEqual(commitment.github_issue_url, 'https://github.com/owner/repo/issues/13');
    assert.strictEqual(commitment.github_sync_failure_count, 0);
    assert.strictEqual(commitment.github_sync_quarantined_at, null);
    assert.strictEqual(commitment.github_sync_quarantine_reason, null);
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

  it('loads only GitHub sync eligible production commitments', async () => {
    const suffix = Date.now();
    const eligibleId = await saveCommitment({
      text: `Production sync eligible ${suffix}`,
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: `T-sync-eligible-${suffix}`,
      messageTs: `M-sync-eligible-${suffix}`,
    });
    const fixtureId = await saveCommitment({
      text: `fixture-filter-${suffix}`,
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: `T-sync-fixture-${suffix}`,
      messageTs: `M-sync-fixture-${suffix}`,
    });
    const quarantinedId = await saveCommitment({
      text: `Production sync quarantined ${suffix}`,
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: `T-sync-quarantined-${suffix}`,
      messageTs: `M-sync-quarantined-${suffix}`,
    });
    const duplicateId = await saveCommitment({
      text: `Production sync eligible ${suffix}`,
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: `T-sync-duplicate-${suffix}`,
      messageTs: `M-sync-duplicate-${suffix}`,
    });

    await updateCommitmentGithubMetadata(eligibleId, {
      issueNumber: 301,
      issueUrl: 'https://github.com/owner/repo/issues/301',
    });
    await updateCommitmentGithubMetadata(fixtureId, {
      issueNumber: 302,
      issueUrl: 'https://github.com/owner/repo/issues/302',
    });
    await updateCommitmentGithubMetadata(quarantinedId, {
      issueNumber: 303,
      issueUrl: 'https://github.com/owner/repo/issues/303',
    });
    await updateCommitmentGithubMetadata(duplicateId, {
      issueNumber: 301,
      issueUrl: 'https://github.com/owner/repo/issues/301',
    });
    await recordGithubSyncFailure(quarantinedId, { reason: 'github_status_404', maxFailures: 1 });

    const ids = (await getGithubSyncEligibleCommitments()).map((commitment) => commitment.id);

    assert.ok(ids.includes(eligibleId));
    assert.ok(!ids.includes(fixtureId));
    assert.ok(!ids.includes(quarantinedId));
    assert.ok(!ids.includes(duplicateId));
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

  it('does not transition a commitment that is already completed', async () => {
    const id = await saveCommitment({
      text: `Already completed commitment ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: `T-complete-twice-${Date.now()}`,
      messageTs: `M-complete-twice-${Date.now()}`,
    });

    assert.strictEqual(await markCommitmentCompleted(id), true);
    assert.strictEqual(await markCommitmentCompleted(id), false);
  });

  it('returns false when completing a missing commitment', async () => {
    const updated = await markCommitmentCompleted(-1);

    assert.strictEqual(updated, false);
  });
});
