import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { migrateDown, migrateToLatest } from '../../src/db/migrate.ts';
import { useTestDb } from './db.ts';

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

const t = useTestDb({ migrate: false });

async function tables(): Promise<string[]> {
  const { rows } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `.execute(t.db);
  return rows.map((r) => r.table_name);
}

describe('migrations', () => {
  it('create the full schema', async () => {
    await migrateToLatest(t.db);
    expect(await tables()).toEqual(TABLES);
  });

  it('use the defaults and constraints from the design', async () => {
    const household = await t.db
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

    const plant = await t.db
      .insertInto('plants')
      .values({ household_id: household.id, name: 'Pothos' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const schedule = await t.db
      .insertInto('care_schedules')
      .values({ plant_id: plant.id, task_type: 'water', interval_days: 7, next_due: '2026-11-15' })
      .returning('next_due')
      .executeTakeFirstOrThrow();
    expect(schedule.next_due).toBe('2026-11-15');

    await expect(
      t.db
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
    await migrateDown(t.db);
    expect(await tables()).toEqual(['kysely_migration', 'kysely_migration_lock']);
    await migrateToLatest(t.db);
    expect(await tables()).toEqual(TABLES);
  });
});
