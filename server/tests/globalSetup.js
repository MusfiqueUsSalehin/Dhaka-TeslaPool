/**
 * Runs once before all test files: rebuild the test database schema from the migrations,
 * so tests always exercise the real constraints and indexes.
 * (globalSetup runs outside the test workers, so it sets its own env defaults.)
 */
export async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL || 'postgres://tesla:tesla@localhost:5432/tesla_pool_test';
  process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
  process.env.LOG_LEVEL ||= 'silent';

  const { db } = await import('../src/db/knex.js');
  await db.migrate.rollback(undefined, true);
  const [, files] = await db.migrate.latest();
  console.log(`[tests] migrated test database (${files.length} migrations)`);
  await db.destroy();
}
