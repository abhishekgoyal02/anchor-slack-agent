import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = process.env.TEST_DATABASE_PATH || join(tmpdir(), `anchor-test-commitments-${process.pid}.db`);

rmSync(process.env.TEST_DATABASE_PATH, { force: true });
process.on('exit', () => {
  try {
    rmSync(process.env.TEST_DATABASE_PATH, { force: true });
  } catch {
    // SQLite may still be closing on Windows; the next test run removes this file before use.
  }
});
