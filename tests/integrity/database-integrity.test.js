import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { describe, it, mock } from 'node:test';

import { startAnchorApp } from '../../app.js';
import { handleCommitmentConfirm } from '../../listeners/actions/commitment-buttons.js';
import { createSearchCommitmentsTool } from '../../mcp/tools/search-commitments.js';
import { searchCommitments } from '../../services/commitment-search-service.js';
import { createContextSnapshot } from '../../services/context-snapshot.js';
import { postLoopClosureMessage } from '../../services/slack-loop-closure.js';
import { syncGitHubIssueStatuses } from '../../services/sync-service.js';
import {
  getAllCommitments,
  getCommitmentDatabasePath,
  getProductionCommitmentDatabasePath,
  saveCommitment,
  updateCommitmentGithubMetadata,
} from '../../storage/commitment-store.js';

function getProductionStat() {
  const productionPath = getProductionCommitmentDatabasePath();
  return existsSync(productionPath) ? statSync(productionPath) : null;
}

async function hashProductionDatabase() {
  const productionPath = getProductionCommitmentDatabasePath();
  if (!existsSync(productionPath)) {
    return 'missing';
  }

  const contents = await readFile(productionPath);
  return createHash('sha256').update(contents).digest('hex');
}

async function getCommitmentCount() {
  return (await getAllCommitments()).length;
}

function createConfirmationBody(text = "I'll fix the database integrity audit today") {
  return {
    actions: [{ value: text }],
    user: { id: 'U024REALUSER', username: 'abhishek' },
    channel: { id: 'C123' },
    message: { ts: '171.100', thread_ts: '171.111' },
  };
}

function createSlackClient() {
  return {
    chat: {
      update: mock.fn(async () => ({ ok: true })),
      postEphemeral: mock.fn(async () => ({ ok: true })),
      postMessage: mock.fn(async () => ({ ok: true })),
    },
  };
}

describe('database integrity boundaries', () => {
  it('running npm test leaves the production commitments database byte-identical', async (t) => {
    if (process.env.ANCHOR_SKIP_NPM_TEST_HASH_GUARD === '1') {
      t.skip('Skipping nested npm test hash guard.');
      return;
    }

    const before = await hashProductionDatabase();

    const result = spawnSync('npm', ['test'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ANCHOR_SKIP_NPM_TEST_HASH_GUARD: '1',
        NODE_ENV: 'test',
        TEST_DATABASE_PATH: '',
      },
      shell: process.platform === 'win32',
    });

    assert.strictEqual(
      result.status,
      0,
      `npm test failed while checking production DB isolation.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
    assert.strictEqual(await hashProductionDatabase(), before);
  });

  it('uses an isolated test database instead of the production database during tests', async () => {
    const productionPath = getProductionCommitmentDatabasePath();
    const testPath = getCommitmentDatabasePath();
    const before = getProductionStat();

    await saveCommitment({
      text: 'Test isolation commitment',
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: 'T-integrity-isolation',
      messageTs: 'M-integrity-isolation',
    });

    const after = getProductionStat();
    assert.notStrictEqual(testPath, productionPath);
    assert.match(testPath, /anchor-test-commitments/);
    assert.strictEqual(after?.mtimeMs, before?.mtimeMs);
    assert.strictEqual(after?.size, before?.size);
  });

  it('resolves the production database path during normal runtime', () => {
    const productionPath = getProductionCommitmentDatabasePath();
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          'import "dotenv/config";',
          'import { getCommitmentDatabasePath, getProductionCommitmentDatabasePath } from "./storage/commitment-store.js";',
          'console.log(JSON.stringify({ resolved: getCommitmentDatabasePath(), production: getProductionCommitmentDatabasePath(), nodeEnv: process.env.NODE_ENV || "" }));',
        ].join(' '),
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: '',
          DATABASE_PATH: '',
          TEST_DATABASE_PATH: '',
        },
      },
    );

    assert.strictEqual(result.status, 0, `Runtime DB path probe failed.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.strictEqual(output.nodeEnv, '');
    assert.strictEqual(output.resolved, productionPath);
    assert.strictEqual(output.production, productionPath);
  });

  it('inserts exactly one row for one confirmed commitment', async () => {
    const originalFetch = globalThis.fetch;
    const client = createSlackClient();
    const text = "I'll fix one confirmed commitment insert today";
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_OWNER = 'owner';
    process.env.GITHUB_REPO = 'repo';
    const fetchMock = mock.fn(async () => ({
      ok: true,
      json: async () => ({ number: 201, html_url: 'https://github.com/owner/repo/issues/201' }),
    }));
    globalThis.fetch = fetchMock;

    const before = await getCommitmentCount();
    try {
      await handleCommitmentConfirm({
        ack: async () => {},
        body: createConfirmationBody(text),
        client,
        logger: { debug: () => {}, error: () => {}, warn: () => {} },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const commitments = await getAllCommitments();
    const matching = commitments.filter((commitment) => commitment.text === text);
    assert.strictEqual(commitments.length, before + 1);
    assert.strictEqual(matching.length, 1);
    assert.strictEqual(matching[0].github_issue_number, 201);
  });

  it('does not insert a duplicate row when the same confirmation is handled twice', async () => {
    const originalFetch = globalThis.fetch;
    const client = createSlackClient();
    const text = "I'll prevent duplicate confirmation inserts today";
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_OWNER = 'owner';
    process.env.GITHUB_REPO = 'repo';
    const fetchMock = mock.fn(async () => ({
      ok: true,
      json: async () => ({ number: 202, html_url: 'https://github.com/owner/repo/issues/202' }),
    }));
    globalThis.fetch = fetchMock;

    try {
      await handleCommitmentConfirm({
        ack: async () => {},
        body: createConfirmationBody(text),
        client,
        logger: { debug: () => {}, error: () => {}, warn: () => {} },
      });
      await handleCommitmentConfirm({
        ack: async () => {},
        body: createConfirmationBody(text),
        client,
        logger: { debug: () => {}, error: () => {}, warn: () => {} },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const matching = (await getAllCommitments()).filter((commitment) => commitment.text === text);
    assert.strictEqual(matching.length, 1);
    assert.ok(fetchMock.mock.callCount() >= 1);
  });

  it('keeps startup read-only for commitments', async () => {
    const before = await getCommitmentCount();
    await startAnchorApp({
      app: {
        logger: { info: () => {} },
        client: {},
        start: async () => {},
      },
      register: () => {},
      startSync: () => {},
    });

    assert.strictEqual(await getCommitmentCount(), before);
  });

  it('keeps polling and GitHub sync from inserting commitments', async () => {
    const id = await saveCommitment({
      text: "I'll keep sync read-only for inserts",
      userId: 'U024REALUSER',
      channelId: 'C123',
      threadTs: 'T-sync-read-only',
      messageTs: 'M-sync-read-only',
    });
    await updateCommitmentGithubMetadata(id, {
      issueNumber: 203,
      issueUrl: 'https://github.com/owner/repo/issues/203',
    });
    const before = await getCommitmentCount();

    await syncGitHubIssueStatuses({
      client: createSlackClient(),
      fetchIssue: async () => ({
        number: 203,
        state: 'open',
        url: 'https://github.com/owner/repo/issues/203',
        title: 'Read only sync',
        body: '',
      }),
      logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    });

    assert.strictEqual(await getCommitmentCount(), before);
  });

  it('keeps Ask Anchor, MCP, Context Snapshot, and Loop Closure read-only for commitments', async () => {
    const before = await getCommitmentCount();

    await searchCommitments({ query: 'database' });
    await createSearchCommitmentsTool().execute({ query: 'database' });
    await createContextSnapshot("I'll document database integrity", {
      geminiService: { generateText: async () => '{"title":"Database integrity"}' },
    });
    await postLoopClosureMessage(createSlackClient(), {
      completion_description: 'Database integrity',
      user_id: 'U024REALUSER',
      channel_id: 'C123',
      thread_ts: 'T-loop-read-only',
    }, {
      number: 204,
    });

    assert.strictEqual(await getCommitmentCount(), before);
  });
});
