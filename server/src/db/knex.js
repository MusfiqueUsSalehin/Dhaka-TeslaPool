import knexFactory from 'knex';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { serviceUnavailable } from '../lib/errors.js';

// pg returns BIGINT (int8) and NUMERIC as strings to avoid precision loss.
// Our bigints are paisa amounts far below 2^53, so converting to Number is safe
// and keeps the rest of the code free of string/number confusion.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric (only lat/lng)

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../migrations');
export const SEEDS_DIR = path.resolve(here, '../../seeds');

export const db = knexFactory({
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false, // hosted PG (Neon) has a publicly trusted cert
  },
  pool: { min: 0, max: 10 },
  migrations: { directory: MIGRATIONS_DIR, tableName: 'knex_migrations', loadExtensions: ['.js'] },
  seeds: { directory: SEEDS_DIR, loadExtensions: ['.js'] },
});

// Postgres error codes that mean "try the whole transaction again".
const RETRYABLE = new Set(['40001' /* serialization_failure */, '40P01' /* deadlock_detected */]);
const MAX_ATTEMPTS = 3;

/**
 * Run `work(trx)` inside a single transaction. Every business command goes through
 * here so that its reads, row locks, writes and audit events commit or roll back
 * together. Deadlocks / serialization failures are retried a few times.
 */
export async function withTransaction(work, { label = 'tx' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(work);
    } catch (err) {
      if (RETRYABLE.has(err.code) && attempt < MAX_ATTEMPTS) {
        logger.warn({ label, attempt, pgCode: err.code }, 'transaction conflict, retrying');
        continue;
      }
      if (RETRYABLE.has(err.code)) {
        logger.error({ label, attempt, pgCode: err.code }, 'transaction conflict, giving up');
        throw serviceUnavailable('The system is busy, please try again');
      }
      throw err;
    }
  }
}
