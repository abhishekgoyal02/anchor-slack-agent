import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  formatCommitmentStatus,
  formatGithubIssue,
  formatHumanDate,
  formatSlackMention,
  formatTimestamp,
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
      },
    );

    assert.deepStrictEqual(dto, {
      title: 'Authentication API',
      status: 'Completed',
      githubIssue: '18',
      createdAt: '2026-07-01 00:00:00',
      updatedAt: '2026-07-02 00:00:00',
      assignee: 'Abhishek Goyal',
    });
    assert.strictEqual('id' in dto, false);
    assert.strictEqual('thread' in dto, false);
    assert.strictEqual('channel' in dto, false);
    assert.strictEqual('summary' in dto, false);
    assert.strictEqual('dueDate' in dto, false);
  });

  it('formats status as plain text and supports future statuses', () => {
    assert.strictEqual(formatCommitmentStatus('open'), 'Open');
    assert.strictEqual(formatCommitmentStatus('completed'), 'Completed');
    assert.strictEqual(formatCommitmentStatus('in_progress'), 'In Progress');
    assert.strictEqual(formatCommitmentStatus('archived'), 'Archived');
    assert.strictEqual(formatCommitmentStatus('paused_review'), 'Paused Review');
  });

  it('formats GitHub issue labels', () => {
    assert.strictEqual(formatGithubIssue(13), '13');
    assert.strictEqual(formatGithubIssue(null), null);
  });

  it('formats Slack assignees as mentions and omits missing values', () => {
    assert.strictEqual(formatSlackMention('Abhishek Goyal'), 'Abhishek Goyal');
    assert.strictEqual(formatSlackMention(''), null);
  });

  it('formats stored timestamps without changing spacing or timezone', () => {
    assert.strictEqual(formatTimestamp('2026-07-01 07:12:35'), '2026-07-01 07:12:35');
    assert.strictEqual(formatTimestamp(''), '');
  });

  it('formats dates in a human-friendly way', () => {
    const now = new Date('2026-07-04T12:00:00Z');

    assert.strictEqual(formatHumanDate('2026-07-04 01:00:00', now), 'Today');
    assert.strictEqual(formatHumanDate('2026-07-03 01:00:00', now), 'Yesterday');
    assert.strictEqual(formatHumanDate('2026-07-02 01:00:00', now), '2 days ago');
    assert.strictEqual(formatHumanDate('2026-06-20 01:00:00', now), 'Jun 20, 2026');
  });
});
