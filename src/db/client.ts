import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { Database } from './schema.ts';

// Read `date` and `time` columns as plain strings: a JS Date would shift calendar dates
// by the process's time zone, while households each have their own.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.TIME, (value) => value);

export type Db = Kysely<Database>;

export function createDb(connectionString: string): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 10 }),
    }),
  });
}

// Runs `fn` in a transaction, or inside the caller's one when `db` already is a transaction,
// so a domain write and the agent's `tool_calls` record can commit together.
export function inTransaction<T>(db: Db, fn: (trx: Db) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db) : db.transaction().execute(fn);
}
