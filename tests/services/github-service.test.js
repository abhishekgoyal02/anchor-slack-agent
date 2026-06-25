import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  createIssue,
  formatIssueBody,
  formatIssueTitle,
  GitHubServiceError,
  getGitHubConfig,
  getIssue,
} from '../../services/github-service.js';

describe('github-service', () => {
  it('formats issue titles from commitment text', () => {
    assert.strictEqual(formatIssueTitle("I'll finish the API tomorrow"), 'Finish the API tomorrow');
    assert.strictEqual(formatIssueTitle("Let's deploy the fix tomorrow"), 'Deploy the fix tomorrow');
    assert.strictEqual(formatIssueTitle('I will review the PR.'), 'Review the PR');
  });

  it('formats issue bodies with Slack context', () => {
    const body = formatIssueBody({
      text: "I'll finish the API tomorrow",
      userId: 'U123',
      threadTs: '171.123',
    });

    assert.match(body, /Created by Anchor/);
    assert.match(body, /Original commitment:\nI'll finish the API tomorrow/);
    assert.match(body, /Slack User:\nU123/);
    assert.match(body, /Slack Thread:\n171\.123/);
    assert.match(body, /Status:\nOpen/);
  });

  it('validates required GitHub configuration', () => {
    const previousToken = process.env.GITHUB_TOKEN;
    const previousOwner = process.env.GITHUB_OWNER;
    const previousRepo = process.env.GITHUB_REPO;

    delete process.env.GITHUB_TOKEN;
    process.env.GITHUB_OWNER = 'owner';
    process.env.GITHUB_REPO = 'repo';

    assert.throws(() => getGitHubConfig(), GitHubServiceError);

    process.env.GITHUB_TOKEN = previousToken;
    process.env.GITHUB_OWNER = previousOwner;
    process.env.GITHUB_REPO = previousRepo;
  });

  it('creates a GitHub issue and returns normalized metadata', async () => {
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ number: 12, html_url: 'https://github.com/owner/repo/issues/12' }),
      };
    };

    const issue = await createIssue(
      { text: "I'll finish the API tomorrow", userId: 'U123', threadTs: '171.123' },
      { config: { token: 'token', owner: 'owner', repo: 'repo' }, fetchImpl },
    );

    assert.deepStrictEqual(issue, { number: 12, url: 'https://github.com/owner/repo/issues/12' });
    assert.strictEqual(request.url, 'https://api.github.com/repos/owner/repo/issues');
    assert.strictEqual(request.options.method, 'POST');
    assert.strictEqual(request.options.headers.Authorization, 'Bearer token');
    assert.deepStrictEqual(JSON.parse(request.options.body), {
      title: 'Finish the API tomorrow',
      body: formatIssueBody({ text: "I'll finish the API tomorrow", userId: 'U123', threadTs: '171.123' }),
    });
  });

  it('throws sanitized errors for GitHub API failures', async () => {
    const logMessages = [];
    const fetchImpl = async () => ({
      ok: false,
      status: 404,
      text: async () => '{"message":"Not Found"}',
    });

    await assert.rejects(
      createIssue(
        { text: "I'll finish the API tomorrow", userId: 'U123', threadTs: '171.123' },
        {
          config: { token: 'token', owner: 'owner', repo: 'repo' },
          fetchImpl,
          logger: { error: (message) => logMessages.push(message) },
        },
      ),
      /GitHub issue creation failed/,
    );

    assert.strictEqual(logMessages.length, 1);
    assert.match(logMessages[0], /owner=owner/);
    assert.match(logMessages[0], /repo=repo/);
    assert.match(logMessages[0], /url=https:\/\/api\.github\.com\/repos\/owner\/repo\/issues/);
    assert.match(logMessages[0], /status=404/);
    assert.match(logMessages[0], /response_body=\{"message":"Not Found"\}/);
    assert.doesNotMatch(logMessages[0], /token/);
  });

  it('gets a GitHub issue and returns normalized status', async () => {
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          number: 12,
          state: 'closed',
          html_url: 'https://github.com/owner/repo/issues/12',
        }),
      };
    };

    const issue = await getIssue(12, {
      config: { token: 'token', owner: 'owner', repo: 'repo' },
      fetchImpl,
    });

    assert.deepStrictEqual(issue, {
      number: 12,
      state: 'closed',
      url: 'https://github.com/owner/repo/issues/12',
    });
    assert.strictEqual(request.url, 'https://api.github.com/repos/owner/repo/issues/12');
    assert.strictEqual(request.options.method, 'GET');
    assert.strictEqual(request.options.headers.Authorization, 'Bearer token');
  });

  it('logs GitHub issue lookup failures without exposing tokens', async () => {
    const logMessages = [];
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      text: async () => '{"message":"API rate limit exceeded"}',
    });

    await assert.rejects(
      getIssue(12, {
        config: { token: 'token', owner: 'owner', repo: 'repo' },
        fetchImpl,
        logger: { error: (message) => logMessages.push(message) },
      }),
      /GitHub issue fetch failed/,
    );

    assert.strictEqual(logMessages.length, 1);
    assert.match(logMessages[0], /owner=owner/);
    assert.match(logMessages[0], /repo=repo/);
    assert.match(logMessages[0], /url=https:\/\/api\.github\.com\/repos\/owner\/repo\/issues\/12/);
    assert.match(logMessages[0], /status=403/);
    assert.match(logMessages[0], /response_body=\{"message":"API rate limit exceeded"\}/);
    assert.doesNotMatch(logMessages[0], /token/);
  });
});
