import { defineConfig } from 'vitest/config';

// Integration tests hit a real PostgreSQL database (the constraints and row locks are
// exactly what we want to test), so files run one at a time against a dedicated DB.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.js'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://tesla:tesla@localhost:5432/tesla_pool_test',
      JWT_SECRET: 'test-secret-that-is-long-enough',
      LOG_LEVEL: process.env.TEST_LOG_LEVEL || 'silent',
    },
  },
});
