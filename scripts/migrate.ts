// Runs the database migrations: `npm run db:migrate` (to latest) or `npm run db:migrate -- down`.
import { loadConfig } from '../src/config.ts';
import { createDb } from '../src/db/client.ts';
import { migrateDown, migrateToLatest } from '../src/db/migrate.ts';
import { createLogger } from '../src/ops/logger.ts';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createDb(config.databaseUrl);

try {
  const run = process.argv[2] === 'down' ? migrateDown : migrateToLatest;
  const { results = [] } = await run(db);
  for (const r of results) {
    logger.info(
      { migration: r.migrationName, direction: r.direction, status: r.status },
      'migration',
    );
  }
  if (results.length === 0) logger.info('no migrations to run');
} catch (error) {
  logger.error({ err: error }, 'migration failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
