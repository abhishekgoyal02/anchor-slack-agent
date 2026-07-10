import assert from 'node:assert';
import { describe, it } from 'node:test';

import { detectCommitment } from '../../services/commitment-detector.js';

describe('detectCommitment', () => {
  it('detects concrete future commitments across broad verbs and timelines', () => {
    const examples = [
      "I'll finish the API tomorrow",
      'Ill fix Google Authentication before Friday.',
      'Ill take care of the Google Authentication bug before Friday so nobody else needs to pick it up.',
      "I'll set up Docker by Monday.",
      "I'll complete authentication tomorrow",
      "I'll complete API setup tomorrow.",
      "I'll complete the login API by Friday.",
      "I'll provide API keys tomorrow",
      "I'll provide API keys by tomorrow",
      "I'll send the report tonight.",
      "I'll send the design tonight",
      "I'll review the PR tomorrow",
      "I'll review the PR tonight.",
      "I'll merge the branch.",
      "I'll push the changes.",
      "I'll upload the dataset.",
      "I'll prepare the presentation.",
      "I'll update the documentation.",
      "I'll deploy after lunch.",
      "I'll deploy tomorrow",
      "I'll merge the PR tonight",
      "I'll push the branch",
      "I'll update the docs",
      "I'll review this tomorrow",
      "I'll send credentials today",
      "I'll fix authentication before Friday",
      "I'll migrate authentication to OAuth 2.0 this weekend",
      "I'll investigate the issue.",
      "I'll contact the client.",
      "I'll submit the assignment.",
      "I'll configure authentication.",
      "I'll write unit tests.",
      "I'll fix the API tomorrow.",
      "I'll share the document later",
      "I'll update the README today",
      "I'll deploy after lunch",
      "I'll investigate the bug this evening",
      "I'll prepare the demo before Monday",
      "I'll push the changes tonight",
      "I'll message the client tomorrow",
      "I'll upload the dataset",
      "I'll write the documentation this weekend",
      "I'll fix the tests by Wednesday",
      "I'll merge the branch next week",
      "I'll create the release notes this afternoon",
      "I'll implement OAuth by Friday",
      "I'll deliver the patch in 3 hours",
      "I'll contact the vendor within 2 days",
      "I'll follow up with Legal within 2 days",
      "I'll send credentials in 3 hours",
      "I'll schedule the review on Tuesday",
      "I'll publish the changelog before Friday",
      "I'll submit the report tomorrow",
      "I'll configure the pipeline this evening",
      "I'll document the endpoint today",
      "I'll refactor the auth module next week",
      "I'll test the rollout tonight",
      "I'll do API documentation by Wednesday",
      "I'll handle deployment.",
      "I'll own authentication.",
      "I'll take care of the docs.",
      "I'll patch Redis tonight.",
      "I'll try to update the docs tomorrow.",
      "I'm going to fix the login bug by EOD.",
      'Ill fix it.',
      'I will review the PR',
      "I'll send the deck by Friday",
      "We'll finish this by Friday.",
      'We should ship this week.',
      'Need to update the README.',
      'Need to finish testing today.',
      'Need to finish this today.',
      "Let's ship Friday.",
      'Lets ship Friday.',
      'Taking this task.',
      'I can take Docker.',
      'Can take this one.',
      'Im on it.',
      "I'm on it.",
      'I got this.',
      "I'll look into it.",
      "I'll do it.",
      'Leaving deployment for Monday.',
      'This needs to be done before release.',
      "Let's deploy the fix tomorrow",
      'I can handle the migration',
      'Let me follow up with Design',
      "I'll test after work",
    ];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), true, example);
    }
  });

  it('detects multiline commitments as a single commitment', () => {
    const message = [
      "I'll migrate authentication to OAuth 2.0 this weekend.",
      '',
      'Need to:',
      '- update JWT validation',
      '- replace refresh tokens',
      '- update documentation',
      '- verify login flow',
      '- write tests',
    ].join('\n');

    assert.strictEqual(detectCommitment(message), true);
  });

  it('rejects incomplete or uncertain statements', () => {
    const examples = [
      "I'll",
      'I will',
      "maybe I'll",
      'I might',
      'I think',
      'I hope',
      "maybe I'll update the docs",
      "maybe I'll try to update the docs tomorrow",
      'I may review later',
      'probably I will fix it',
      'possibly we will deploy',
      'hopefully I will merge it',
      'I guess I will send it',
      'I suppose I can share',
    ];

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
      "I'll provide tomorrow",
      "I'll send tonight",
      "I'll write this weekend",
      "I'll message later",
      "I'll try to finish tomorrow",
    ];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), false, example);
    }
  });

  it('ignores unrelated messages', () => {
    const examples = [
      'The API is almost done',
      'Can someone review the PR?',
      'Thanks for the update',
      'thanks, got it',
      'Did you deploy after lunch?',
      'Please send the design tomorrow.',
      'He will complete the task tomorrow.',
      'We completed the rollout yesterday.',
      'I completed the task already.',
      'The PR was merged today.',
      'Upload the dataset now.',
      'Could you update the README by Friday?',
      'Review scheduled for Monday.',
      'hello',
      'nice work',
      'sounds good',
      'approved',
      'done?',
      'what is API?',
      'who is Elon Musk?',
      'explain Docker',
      'search authentication',
      'Search API',
      'show open commitments',
      'show completed commitments',
      'Who owns authentication?',
      'Who is working on authentication?',
      'Whats blocking release?',
      'ask anchor',
      'context snapshot',
      'loop closure',
      'good morning',
      'looks good',
    ];

    for (const example of examples) {
      assert.strictEqual(detectCommitment(example), false, example);
    }
  });
});
