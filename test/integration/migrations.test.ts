import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.ts';
import { createDb, type Db } from '../../src/db/client.ts';
import { migrateDown, migrateToLatest } from '../../src/db/migrate.ts';

const TABLES = [
  'activation_codes',
  'care_events',
  'care_schedules',
  'chats',
  'crypto_keys',
  'households',
  'identities',
  'kysely_migration',
  'kysely_migration_lock',
  'llm_usage',
  'memberships',
  'messages',
  'people',
  'plant_notes',
  'plants',
  'reminder_runs',
  'tool_calls',
  'wa_auth_state',
];

// Each run gets its own throwaway database on the server DATABASE_URL points at.
const { databaseUrl } = loadConfig();
const dbName = `plent_test_${randomUUID().replaceAll('-', '')}`;
let admin: Db;
let db: Db;

beforeAll(async () => {
  admin = createDb(databaseUrl);
  await sql`create database ${sql.id(dbName)}`.execute(admin);
  const url = new URL(databaseUrl);
  url.pathname = `/${dbName}`;
  db = createDb(url.toString());
});

afterAll(async () => {
  await db.destroy();
  await sql`drop database if exists ${sql.id(dbName)}`.execute(admin);
  await admin.destroy();
});

async function tables(): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `.execute(db);
  return rows.map((r) => r.table_name);
}

describe('migrations', () => {
  it('create the full schema', async () => {
    await migrateToLatest(db);
    expect(await tables()).toEqual(TABLES);
  });

  it('use the defaults and constraints from the design', async () => {
    const household = await db
      .insertInto('households')
      .defaultValues()
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(household).toMatchObject({
      status: 'pending',
      timezone: 'UTC',
      reminder_time: '09:00:00',
      daily_llm_cap: 200,
    });

    const plant = await db
      .insertInto('plants')
      .values({ household_id: household.id, name: 'Pothos' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const schedule = await db
      .insertInto('care_schedules')
      .values({ plant_id: plant.id, task_type: 'water', interval_days: 7, next_due: '2026-11-15' })
      .returning('next_due')
      .executeTakeFirstOrThrow();
    expect(schedule.next_due).toBe('2026-11-15');

    await expect(
      db
        .insertInto('care_schedules')
        .values({
          plant_id: plant.id,
          task_type: 'water',
          interval_days: 3,
          next_due: '2026-11-10',
        })
        .execute(),
    ).rejects.toThrow(/care_schedules_plant_id_task_type_key/);
  });

  it('roll back to an empty database', async () => {
    await migrateDown(db);
    expect(await tables()).toEqual(['kysely_migration', 'kysely_migration_lock']);
    await migrateToLatest(db);
    expect(await tables()).toEqual(TABLES);
  });
});
