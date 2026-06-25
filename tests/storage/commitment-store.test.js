import assert from 'node:assert';
import { describe, it } from 'node:test';

import { getCommitmentById, saveCommitment, updateCommitmentGithubMetadata } from '../../storage/commitment-store.js';

describe('commitment-store', () => {
  it('saves a commitment and returns the inserted ID', async () => {
    const id = await saveCommitment({
      text: `Test commitment ${Date.now()}`,
      userId: 'U123',
      channelId: 'C123',
      threadTs: `T-${Date.now()}`,
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
});
