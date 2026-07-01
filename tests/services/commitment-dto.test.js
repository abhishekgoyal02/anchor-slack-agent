import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  formatCommitmentStatus,
  formatGithubIssue,
  formatHumanDate,
  toCommitmentDto,
} from '../../services/commitment-dto.js';

describe('commitment DTO', () => {
  it('maps storage rows to a minimal user-friendly DTO', () => {
    const dto = toCommitmentDto(
      {
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
        assignee_name: 'Abhishek Goyal',
        due_date: '2026-07-03 00:00:00',
        summary: 'Complete token refresh support.',
      },
      { now: new Date('2026-07-04T12:00:00Z') },
    );

    assert.deepStrictEqual(dto, {
      title: 'Authentication API',
      status: '✅ Completed',
      githubIssue: 'GitHub Issue #18',
      created: '3 days ago',
      dueDate: 'Yesterday',
      summary: 'Complete token refresh support.',
      assigneeName: 'Abhishek Goyal',
    });
    assert.strictEqual('id' in dto, false);
    assert.strictEqual('thread' in dto, false);
    assert.strictEqual('channel' in dto, false);
    assert.strictEqual('assignee' in dto, false);
    assert.strictEqual('updatedAt' in dto, false);
  });

  it('formats status with emoji and supports future statuses', () => {
    assert.strictEqual(formatCommitmentStatus('open'), '🟡 Open');
    assert.strictEqual(formatCommitmentStatus('completed'), '✅ Completed');
    assert.strictEqual(formatCommitmentStatus('in_progress'), '🔵 In Progress');
    assert.strictEqual(formatCommitmentStatus('archived'), '⚪ Archived');
    assert.strictEqual(formatCommitmentStatus('paused_review'), 'Paused Review');
  });

  it('formats GitHub issue labels', () => {
    assert.strictEqual(formatGithubIssue(13), 'GitHub Issue #13');
    assert.strictEqual(formatGithubIssue(null), 'No GitHub issue linked');
  });

  it('formats dates in a human-friendly way', () => {
    const now = new Date('2026-07-04T12:00:00Z');

    assert.strictEqual(formatHumanDate('2026-07-04 01:00:00', now), 'Today');
    assert.strictEqual(formatHumanDate('2026-07-03 01:00:00', now), 'Yesterday');
    assert.strictEqual(formatHumanDate('2026-07-02 01:00:00', now), '2 days ago');
    assert.strictEqual(formatHumanDate('2026-06-20 01:00:00', now), 'Jun 20, 2026');
  });
});
