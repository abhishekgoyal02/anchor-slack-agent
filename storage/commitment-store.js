import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'commitments.db');

const db = new sqlite3.Database(DB_PATH);

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
`).then(async () => {
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
export async function saveCommitment({
  text,
  userId,
  channelId,
  threadTs,
  messageTs,
}) {
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
    [
      text,
      userId,
      channelId,
      threadTs,
      messageTs,
    ],
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
  const { changes } = await run('UPDATE commitments SET github_issue_number = ?, github_issue_url = ? WHERE id = ?', [
    issueNumber,
    issueUrl,
    id,
  ]);
  return changes > 0;
}

/**
 * Mark a commitment as completed.
 * @param {number} id
 * @returns {Promise<boolean>} True when a row was updated.
 */
export async function markCommitmentCompleted(id) {
  await initPromise;
  const { changes } = await run("UPDATE commitments SET status = ?, completed_at = datetime('now') WHERE id = ?", [
    'completed',
    id,
  ]);
  return changes > 0;
}

/**
 * Get a single commitment by ID.
 * @param {number} id
 * @returns {Promise<object | undefined>}
 */
export async function getCommitmentById(id) {
  await initPromise;
  return get('SELECT * FROM commitments WHERE id = ?', [id]);
}

/**
 * Get all commitments with status "open".
 * @returns {Promise<Array<object>>}
 */
export async function getAllOpenCommitments() {
  await initPromise;
  return all('SELECT * FROM commitments WHERE status = ? ORDER BY created_at ASC', ['open']);
}

/**
 * Get all open commitments linked to GitHub issues.
 * @returns {Promise<Array<object>>}
 */
export async function getOpenCommitmentsWithGithubIssues() {
  await initPromise;
  return all('SELECT * FROM commitments WHERE status = ? AND github_issue_number IS NOT NULL ORDER BY created_at ASC', [
    'open',
  ]);
}

/**
 * Find an open commitment by thread and text.
 * @param {string} threadTs
 * @param {string} text
 * @returns {Promise<object | undefined>}
 */
export async function findOpenCommitmentByThreadAndText(threadTs, text) {
  await initPromise;
  return get('SELECT * FROM commitments WHERE thread_ts = ? AND text = ? AND status = ?', [threadTs, text, 'open']);
}
