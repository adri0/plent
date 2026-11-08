import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, beforeAll } from 'vitest';

import { loadConfig } from '../../src/config.ts';
import { createDb, type Db } from '../../src/db/client.ts';
import { migrateToLatest } from '../../src/db/migrate.ts';

// Gives a test file its own throwaway database on the server DATABASE_URL points at, dropped
// when the file's tests end. Call at the top level; read `.db` inside tests.
export function useTestDb(options: { migrate?: boolean } = {}): { readonly db: Db } {
  const { databaseUrl } = loadConfig();
  const name = `plent_test_${randomUUID().replaceAll('-', '')}`;
  let admin: Db | undefined;
  let db: Db | undefined;

  beforeAll(async () => {
    admin = createDb(databaseUrl);
    await sql`create database ${sql.id(name)}`.execute(admin);
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    db = createDb(url.toString());
    if (options.migrate ?? true) await migrateToLatest(db);
  });

  afterAll(async () => {
    await db?.destroy();
    if (admin !== undefined) {
      await sql`drop database if exists ${sql.id(name)}`.execute(admin);
      await admin.destroy();
    }
  });

  return {
    get db(): Db {
      if (db === undefined) throw new Error('useTestDb: the database is ready only inside tests');
      return db;
    },
  };
}
