const GITHUB_API_VERSION = '2022-11-28';

/**
 * @typedef {{
 *   text: string,
 *   userId: string,
 *   threadTs: string,
 * }} GitHubIssueInput
 */

/**
 * @typedef {{
 *   number: number,
 *   url: string,
 * }} GitHubIssueResult
 */

/**
 * @typedef {{
 *   token: string,
 *   owner: string,
 *   repo: string,
 * }} GitHubConfig
 */

/**
 * @typedef {{
 *   debug?: (message: string) => void,
 *   error?: (message: string) => void,
 * }} GitHubLogger
 */

export class GitHubServiceError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'GitHubServiceError';
    this.status = options.status;
    this.cause = options.cause;
  }
}

/**
 * @returns {GitHubConfig}
 */
export function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim();
  const repo = process.env.GITHUB_REPO?.trim();

  if (!token || !owner || !repo) {
    throw new GitHubServiceError('GitHub configuration is incomplete.');
  }

  return { token, owner, repo };
}

/**
 * @param {string} text
 * @returns {string}
 */
export function formatIssueTitle(text) {
  const title = text
    .replace(/^\s*["']?/, '')
    .replace(/\b(?:i'll|i will|we'll|we will|let's|let me|i can)\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  if (!title) {
    return 'Anchor commitment';
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * @param {GitHubIssueInput} input
 * @returns {string}
 */
export function formatIssueBody({ text, userId, threadTs }) {
  return [
    'Created by Anchor',
    '',
    'Original commitment:',
    text,
    '',
    'Slack User:',
    userId,
    '',
    'Slack Thread:',
    threadTs,
    '',
    'Status:',
    'Open',
  ].join('\n');
}

/**
 * Create a GitHub issue for a confirmed commitment.
 * @param {GitHubIssueInput} input
 * @param {{ fetchImpl?: typeof fetch, config?: GitHubConfig, logger?: GitHubLogger }} [options]
 * @returns {Promise<GitHubIssueResult>}
 */
export async function createIssue(input, options = {}) {
  const config = options.config ?? getGitHubConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger;
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;

  logger?.debug?.(`Creating GitHub issue: owner=${config.owner}, repo=${config.repo}, url=${url}`);

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      title: formatIssueTitle(input.text),
      body: formatIssueBody(input),
    }),
  }).catch((error) => {
    logger?.error?.(
      `GitHub issue creation request failed: owner=${config.owner}, repo=${config.repo}, url=${url}, error=${error}`,
    );
    throw new GitHubServiceError('GitHub issue creation request failed.', { cause: error });
  });

  if (!response.ok) {
    const responseBody = await readResponseBody(response);
    logger?.error?.(
      `GitHub issue creation failed: owner=${config.owner}, repo=${config.repo}, url=${url}, status=${response.status}, response_body=${responseBody}`,
    );
    throw new GitHubServiceError('GitHub issue creation failed.', { status: response.status });
  }

  const data = await response.json();
  if (typeof data.number !== 'number' || typeof data.html_url !== 'string') {
    logger?.error?.(
      `GitHub issue creation returned an invalid response: owner=${config.owner}, repo=${config.repo}, url=${url}`,
    );
    throw new GitHubServiceError('GitHub issue creation returned an invalid response.');
  }

  return {
    number: data.number,
    url: data.html_url,
  };
}

/**
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function readResponseBody(response) {
  if (typeof response.text !== 'function') {
    return '<unavailable>';
  }

  return response.text().catch((error) => `Unable to read GitHub response body: ${error}`);
}
