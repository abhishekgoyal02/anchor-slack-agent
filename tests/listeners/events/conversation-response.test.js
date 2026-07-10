import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  getRandomOffDomainResponse,
  isOffDomainGeneralKnowledgePrompt,
  setThinkingStatus,
} from '../../../listeners/events/conversation-response.js';

describe('conversation response helpers', () => {
  const approvedOffDomainResponses = new Set([
    "🐧 I'm built for project chaos, not trivia. Try asking about commitments, GitHub issues, blockers, or who's working on something.",
    "🐟 Oops... that's outside my swim lane. Ask me about your team's commitments or project progress instead.",
    "🦈 That's a little beyond my ocean. I keep track of work, not general knowledge. Try a GitHub or commitment question.",
    "🦢 Not my pond today. I'm here for commitments, releases, blockers, and ownership—not encyclopedia mode.",
    "🐠 Nice try. I only keep tabs on your team's work. Ask me about commits, issues, deadlines, or commitments.",
    "🐬 That's one for a general AI assistant. I'm focused on helping your team stay accountable.",
  ]);

  it('continues when Slack assistant status cannot be set', async () => {
    const warningLogs = [];
    const statusError = new Error('not an assistant thread');

    await assert.doesNotReject(
      setThinkingStatus(
        async () => {
          throw statusError;
        },
        {
          warn: (message, context) => {
            warningLogs.push({ message, context });
          },
        },
      ),
    );

    assert.strictEqual(warningLogs.length, 1);
    assert.strictEqual(warningLogs[0].message, 'Failed to set Slack assistant status');
    assert.strictEqual(warningLogs[0].context.message, 'not an assistant thread');
  });

  it('does nothing when no status helper is available', async () => {
    await assert.doesNotReject(setThinkingStatus(undefined));
  });

  it('detects unrelated general knowledge prompts before Gemini routing', () => {
    const examples = [
      'What is API?',
      'What is Photosynthesis?',
      'Explain Docker',
      'What is Java?',
      'What is React?',
      'Explain Kubernetes',
      'What is AI?',
      'Who is Elon Musk?',
      'Who invented Java?',
      'Tell me about Earth.',
      "What's the capital of India?",
      'Write Python code.',
      'Who won the World Cup?',
      'How to cook pasta?',
      'What is recursion?',
      'Explain operating systems.',
      'How does TCP work?',
    ];

    for (const example of examples) {
      assert.strictEqual(isOffDomainGeneralKnowledgePrompt(example), true, example);
    }
  });

  it('keeps greetings and Anchor-domain prompts on the existing route', () => {
    const examples = [
      'hello',
      'hi',
      'hey',
      'thanks',
      'good morning',
      'good afternoon',
      'good evening',
      'bye',
      'Search commitment related to API',
      'Search API',
      'Search authentication',
      'Search GitHub',
      'Search MCP',
      'Search Slack',
      'Who owns OAuth?',
      'Who is working on Docker?',
      'Search Kubernetes',
      'Show deployment work',
      'Show open commitments',
      'Show completed commitments',
      'Show overdue work',
      'Search deployment',
    ];

    for (const example of examples) {
      assert.strictEqual(isOffDomainGeneralKnowledgePrompt(example), false, example);
    }
  });

  it('returns only approved off-domain responses and can vary by random index', () => {
    const originalRandom = Math.random;
    try {
      Math.random = () => 0;
      const firstResponse = getRandomOffDomainResponse();

      Math.random = () => 0.99;
      const lastResponse = getRandomOffDomainResponse();

      assert.ok(approvedOffDomainResponses.has(firstResponse));
      assert.ok(approvedOffDomainResponses.has(lastResponse));
      assert.notStrictEqual(firstResponse, lastResponse);

      for (const response of [firstResponse, lastResponse]) {
        assert.match(response, /^[🐟🦈🐧🦢🐠🐬]/u);
        assert.strictEqual([...response.matchAll(/\p{Emoji_Presentation}/gu)].length, 1);
      }
    } finally {
      Math.random = originalRandom;
    }
  });
});
