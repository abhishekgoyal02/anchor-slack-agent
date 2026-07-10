import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import sqlite3 from 'sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCTION_DB_PATH = join(__dirname, 'commitments.db');
const DB_PATH = resolveDatabasePath();

const db = new sqlite3.Database(DB_PATH);

/**
 * @typedef {{
 *   id: number,
 *   text: string,
 *   user_id: string,
 *   channel_id: string,
 *   thread_ts: string,
 *   message_ts: string | null,
 *   status: string,
 *   created_at: string,
 *   github_issue_number: number | null,
 *   github_issue_url: string | null,
 *   github_sync_failure_count?: number | null,
 *   github_sync_quarantined_at?: string | null,
 *   github_sync_quarantine_reason?: string | null,
 *   completed_at: string | null,
 *   assignee_name?: string | null,
 *   due_date?: string | null,
 *   summary?: string | null,
 * }} Commitment
 */

/**
 * @returns {string}
 */
function resolveDatabasePath() {
  if (process.env.NODE_ENV === 'test') {
    const testPath = process.env.TEST_DATABASE_PATH?.trim();
    return testPath
      ? isAbsolute(testPath)
        ? testPath
        : resolve(process.cwd(), testPath)
      : join(tmpdir(), `anchor-test-commitments-${process.pid}.db`);
  }

  const configuredPath = process.env.DATABASE_PATH?.trim();
  if (configuredPath) {
    return isAbsolute(configuredPath) ? configuredPath : resolve(process.cwd(), configuredPath);
  }

  return PRODUCTION_DB_PATH;
}

/**
 * @returns {string}
 */
export function getCommitmentDatabasePath() {
  return DB_PATH;
}

/**
 * @returns {string}
 */
export function getProductionCommitmentDatabasePath() {
  return PRODUCTION_DB_PATH;
}

/**
 * Promisified wrapper around db.run.
 * @param {string} sql
 * @param {unknown[]} params
 * @returns {Promise<{ lastID: number, changes: number }>}
 */
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Promisified wrapper around db.get.
 * @param {string} sql
 * @param {unknown[]} params
 * @returns {Promise<object | undefined>}
 */
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Promisified wrapper around db.all.
 * @param {string} sql
 * @param {unknown[]} params
 * @returns {Promise<Array<object>>}
 */
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Lazy initialization — resolved once the table exists.
const initPromise = run(`
  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    thread_ts TEXT NOT NULL,
    message_ts TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
  .then(async () => {
    const columns = /** @type {Array<{ name: string }>} */ (await all('PRAGMA table_info(commitments)'));
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has('github_issue_number')) {
      await run('ALTER TABLE commitments ADD COLUMN github_issue_number INTEGER');
    }

    if (!columnNames.has('github_issue_url')) {
      await run('ALTER TABLE commitments ADD COLUMN github_issue_url TEXT');
    }

    if (!columnNames.has('completed_at')) {
      await run('ALTER TABLE commitments ADD COLUMN completed_at TEXT');
    }
    if (!columnNames.has('message_ts')) {
      await run('ALTER TABLE commitments ADD COLUMN message_ts TEXT');
    }

    if (!columnNames.has('github_sync_failure_count')) {
      await run('ALTER TABLE commitments ADD COLUMN github_sync_failure_count INTEGER NOT NULL DEFAULT 0');
    }

    if (!columnNames.has('github_sync_quarantined_at')) {
      await run('ALTER TABLE commitments ADD COLUMN github_sync_quarantined_at TEXT');
    }

    if (!columnNames.has('github_sync_quarantine_reason')) {
      await run('ALTER TABLE commitments ADD COLUMN github_sync_quarantine_reason TEXT');
    }
  })
  .catch((error) => {
    console.error('Failed to initialize sqlite database:', error);
    throw error;
  });

/**
 * Save a confirmed commitment.
 * @param {{
 *   text: string,
 *   userId: string,
 *   channelId: string,
 *   threadTs: string,
 *   messageTs: string,
 * }} commitment
 * @returns {Promise<number>} The ID of the inserted row.
 */
export async function saveCommitment({ text, userId, channelId, threadTs, messageTs }) {
  await initPromise;

  const { lastID } = await run(
    `
      INSERT INTO commitments (
        text,
        user_id,
        channel_id,
        thread_ts,
        message_ts
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    [text, userId, channelId, threadTs, messageTs],
  );

  return lastID;
}

/**
 * Store GitHub metadata for a specific commitment.
 * @param {number} id
 * @param {{ issueNumber: number, issueUrl: string }} metadata
 * @returns {Promise<boolean>} True when a row was updated.
 */
export async function updateCommitmentGithubMetadata(id, { issueNumber, issueUrl }) {
  await initPromise;
  const { changes } = await run(
    `
      UPDATE commitments
      SET
        github_issue_number = ?,
        github_issue_url = ?,
        github_sync_failure_count = 0,
        github_sync_quarantined_at = NULL,
        github_sync_quarantine_reason = NULL
      WHERE id = ?
    `,
    [issueNumber, issueUrl, id],
  );
  return changes > 0;
}

/**
 * Record a failed GitHub sync attempt for a commitment.
 * @param {number} id
 * @param {{ reason: string, maxFailures: number }} options
 * @returns {Promise<{ updated: boolean, failureCount: number, quarantined: boolean }>}
 */
export async function recordGithubSyncFailure(id, { reason, maxFailures }) {
  await initPromise;
  const threshold = Number.isFinite(maxFailures) && maxFailures > 0 ? Math.floor(maxFailures) : 3;
  const existing = /** @type {{ github_sync_failure_count?: number | null } | undefined} */ (
    await get('SELECT github_sync_failure_count FROM commitments WHERE id = ?', [id])
  );

  if (!existing) {
    return { updated: false, failureCount: 0, quarantined: false };
  }

  const failureCount = Math.max(0, existing.github_sync_failure_count ?? 0) + 1;
  const quarantined = failureCount >= threshold;
  await run(
    `
      UPDATE commitments
      SET
        github_sync_failure_count = ?,
        github_sync_quarantined_at = CASE WHEN ? THEN datetime('now') ELSE github_sync_quarantined_at END,
        github_sync_quarantine_reason = CASE WHEN ? THEN ? ELSE github_sync_quarantine_reason END
      WHERE id = ?
    `,
    [failureCount, quarantined ? 1 : 0, quarantined ? 1 : 0, reason, id],
  );

  return { updated: true, failureCount, quarantined };
}

/**
 * Clear GitHub sync retry/quarantine state after a successful poll or relink.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function clearGithubSyncFailure(id) {
  await initPromise;
  const { changes } = await run(
    `
      UPDATE commitments
      SET
        github_sync_failure_count = 0,
        github_sync_quarantined_at = NULL,
        github_sync_quarantine_reason = NULL
      WHERE id = ?
    `,
    [id],
  );
  return changes > 0;
}

/**
 * Mark a commitment as completed.
 * @param {number} id
 * @returns {Promise<boolean>} True when a row was updated.
 */
export async function markCommitmentCompleted(id) {
  await initPromise;
  const { changes } = await run(
    "UPDATE commitments SET status = ?, completed_at = datetime('now') WHERE id = ? AND status = ?",
    ['completed', id, 'open'],
  );
  return changes > 0;
}

/**
 * Get a single commitment by ID.
 * @param {number} id
 * @returns {Promise<Commitment | undefined>}
 */
export async function getCommitmentById(id) {
  await initPromise;
  const row = await get('SELECT * FROM commitments WHERE id = ?', [id]);
  return /** @type {Commitment | undefined} */ (row);
}

/**
 * Get all commitments with status "open".
 * @returns {Promise<Commitment[]>}
 */
export async function getAllOpenCommitments() {
  await initPromise;
  const rows = await all('SELECT * FROM commitments WHERE status = ? ORDER BY created_at ASC', ['open']);
  return /** @type {Commitment[]} */ (rows);
}

/**
 * Get all commitments.
 * @returns {Promise<Commitment[]>}
 */
export async function getAllCommitments() {
  await initPromise;
  const rows = await all('SELECT * FROM commitments ORDER BY created_at ASC');
  return /** @type {Commitment[]} */ (rows);
}

/**
 * Get all open commitments linked to GitHub issues.
 * @returns {Promise<Commitment[]>}
 */
export async function getOpenCommitmentsWithGithubIssues() {
  await initPromise;
  const rows = await all(
    'SELECT * FROM commitments WHERE status = ? AND github_issue_number IS NOT NULL ORDER BY created_at ASC',
    ['open'],
  );
  return /** @type {Commitment[]} */ (rows);
}

/**
 * Get open production commitments eligible for normal GitHub status polling.
 * Fixture and quarantined rows are excluded before the sync service iterates.
 * @returns {Promise<Commitment[]>}
 */
export async function getGithubSyncEligibleCommitments() {
  await initPromise;
  const rows = await all(
    `
      SELECT *
      FROM commitments
      WHERE
        status = ?
        AND github_issue_number IS NOT NULL
        AND github_issue_number > 0
        AND github_issue_url IS NOT NULL
        AND trim(github_issue_url) != ''
        AND github_issue_url LIKE '%/issues/' || github_issue_number || '%'
        AND github_sync_quarantined_at IS NULL
        AND user_id NOT IN ('U123', 'U999')
        AND text NOT LIKE '%dummy%'
        AND text NOT LIKE '%sample row%'
        AND text NOT LIKE '%seed data%'
        AND text NOT LIKE '%fixture-filter-%'
        AND text NOT LIKE '%open-filter-%'
        AND text NOT LIKE 'Test commitment %'
        AND text NOT LIKE 'Test GitHub metadata %'
        AND text NOT LIKE 'Linked commitment %'
        AND text NOT LIKE 'Unlinked commitment %'
        AND text NOT LIKE 'Completable commitment %'
        AND text NOT LIKE 'Already completed commitment %'
        AND text NOT LIKE 'OAuth migration completed %'
        AND NOT EXISTS (
          SELECT 1
          FROM commitments duplicate
          WHERE
            duplicate.id < commitments.id
            AND duplicate.status = commitments.status
            AND duplicate.github_issue_number = commitments.github_issue_number
            AND lower(trim(duplicate.github_issue_url)) = lower(trim(commitments.github_issue_url))
            AND lower(trim(duplicate.text)) = lower(trim(commitments.text))
        )
      ORDER BY created_at ASC
    `,
    ['open'],
  );
  return /** @type {Commitment[]} */ (rows);
}

/**
 * Count rows that GitHub sync intentionally ignores before polling.
 * @returns {Promise<{ eligible: number, fixture: number, quarantined: number }>}
 */
export async function getGithubSyncStartupSummary() {
  await initPromise;
  const row = /** @type {{ eligible: number, fixture: number, quarantined: number } | undefined} */ (
    await get(
      `
        SELECT
          SUM(
            CASE WHEN
              status = 'open'
              AND github_issue_number IS NOT NULL
              AND github_issue_number > 0
              AND github_issue_url IS NOT NULL
              AND trim(github_issue_url) != ''
              AND github_issue_url LIKE '%/issues/' || github_issue_number || '%'
              AND github_sync_quarantined_at IS NULL
              AND NOT (
                user_id IN ('U123', 'U999')
                OR text LIKE '%dummy%'
                OR text LIKE '%sample row%'
                OR text LIKE '%seed data%'
                OR text LIKE '%fixture-filter-%'
                OR text LIKE '%open-filter-%'
                OR text LIKE 'Test commitment %'
                OR text LIKE 'Test GitHub metadata %'
                OR text LIKE 'Linked commitment %'
                OR text LIKE 'Unlinked commitment %'
                OR text LIKE 'Completable commitment %'
                OR text LIKE 'Already completed commitment %'
                OR text LIKE 'OAuth migration completed %'
              )
            THEN 1 ELSE 0 END
          ) AS eligible,
          SUM(
            CASE WHEN
              status = 'open'
              AND github_issue_number IS NOT NULL
              AND (
                user_id IN ('U123', 'U999')
                OR text LIKE '%dummy%'
                OR text LIKE '%sample row%'
                OR text LIKE '%seed data%'
                OR text LIKE '%fixture-filter-%'
                OR text LIKE '%open-filter-%'
                OR text LIKE 'Test commitment %'
                OR text LIKE 'Test GitHub metadata %'
                OR text LIKE 'Linked commitment %'
                OR text LIKE 'Unlinked commitment %'
                OR text LIKE 'Completable commitment %'
                OR text LIKE 'Already completed commitment %'
                OR text LIKE 'OAuth migration completed %'
              )
            THEN 1 ELSE 0 END
          ) AS fixture,
          SUM(
            CASE WHEN
              status = 'open'
              AND github_issue_number IS NOT NULL
              AND github_sync_quarantined_at IS NOT NULL
            THEN 1 ELSE 0 END
          ) AS quarantined
        FROM commitments
      `,
    )
  );

  return {
    eligible: row?.eligible ?? 0,
    fixture: row?.fixture ?? 0,
    quarantined: row?.quarantined ?? 0,
  };
}

/**
 * Find commitments by text.
 * @param {string} query
 * @returns {Promise<Commitment[]>}
 */
export async function findCommitmentsByText(query) {
  await initPromise;
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const rows = await all('SELECT * FROM commitments WHERE text LIKE ? ORDER BY created_at ASC', [
    `%${normalizedQuery}%`,
  ]);
  return /** @type {Commitment[]} */ (rows);
}

/**
 * Find an open commitment by thread and text.
 * @param {string} threadTs
 * @param {string} text
 * @returns {Promise<Commitment | undefined>}
 */
export async function findOpenCommitmentByThreadAndText(threadTs, text) {
  await initPromise;
  const row = await get('SELECT * FROM commitments WHERE thread_ts = ? AND text = ? AND status = ?', [
    threadTs,
    text,
    'open',
  ]);
  return /** @type {Commitment | undefined} */ (row);
}
