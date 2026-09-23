/**
 * Tiny migration/seed runner so we don't depend on the knex CLI's ESM handling.
 *   node src/db/cli.js migrate | rollback | seed | reset
 */
import { db } from './knex.js';
import { logger } from '../lib/logger.js';

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'migrate': {
      const [batch, files] = await db.migrate.latest();
      logger.info({ batch, files }, files.length ? 'migrations applied' : 'database already up to date');
      break;
    }
    case 'rollback': {
      const [batch, files] = await db.migrate.rollback();
      logger.info({ batch, files }, 'migrations rolled back');
      break;
    }
    case 'seed': {
      const [files] = await db.seed.run();
      logger.info({ files }, 'seeds applied');
      break;
    }
    case 'reset': {
      await db.migrate.rollback(undefined, true);
      await db.migrate.latest();
      await db.seed.run();
      logger.info('database reset: rolled back, migrated and seeded');
      break;
    }
    default:
      logger.error(`unknown command "${command}" (use migrate | rollback | seed | reset)`);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    logger.error({ err }, `db ${command} failed`);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
