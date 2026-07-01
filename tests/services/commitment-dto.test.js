import assert from 'node:assert';
import { describe, it } from 'node:test';

import { toCommitmentDto } from '../../services/commitment-dto.js';

describe('commitment DTO', () => {
  it('maps storage rows without exposing database field names', () => {
    const dto = toCommitmentDto({
      id: 12,
      text: 'Authentication API',
      user_id: 'U123',
      channel_id: 'C123',
      thread_ts: 'T123',
      message_ts: 'M123',
      status: 'completed',
      created_at: '2026-07-01 00:00:00',
      github_issue_number: 18,
      github_issue_url: 'https://github.com/example/repo/issues/18',
      completed_at: '2026-07-02 00:00:00',
    });

    assert.deepStrictEqual(dto, {
      id: 12,
      title: 'Authentication API',
      status: 'Completed',
      assignee: 'U123',
      githubIssue: 18,
      createdAt: '2026-07-01 00:00:00',
      updatedAt: '2026-07-02 00:00:00',
      thread: 'T123',
      channel: 'C123',
    });
    assert.strictEqual('user_id' in dto, false);
    assert.strictEqual('thread_ts' in dto, false);
  });
});
