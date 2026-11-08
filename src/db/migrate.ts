import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';

import * as m0001 from './migrations/0001_initial.ts';

// Migrations are imported, not read from disk, so they ship inside the build.
// Add each new migration here; names sort in run order.
const migrations: Record<string, Migration> = {
  '0001_initial': m0001,
};

export function createMigrator<DB>(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
}

export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<MigrationResultSet> {
  return check(await createMigrator(db).migrateToLatest());
}

export async function migrateDown<DB>(db: Kysely<DB>): Promise<MigrationResultSet> {
  return check(await createMigrator(db).migrateDown());
}

function check(resultSet: MigrationResultSet): MigrationResultSet {
  if (resultSet.error !== undefined) {
    const failed = resultSet.results?.find((r) => r.status === 'Error')?.migrationName;
    const what = failed === undefined ? 'Migrations' : `Migration ${failed}`;
    throw new Error(`${what} failed`, { cause: resultSet.error });
  }
  return resultSet;
}
