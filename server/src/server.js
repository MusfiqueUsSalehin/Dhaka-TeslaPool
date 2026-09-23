import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { db } from './db/knex.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, `Dhaka Tesla Pool API listening on :${env.PORT}`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish,
// then close the DB pool. Docker sends SIGTERM on `docker compose down`.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await db.destroy();
    logger.info('bye');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'));
