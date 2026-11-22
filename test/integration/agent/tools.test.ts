import { beforeEach, describe, expect, it } from 'vitest';

import { createAgent } from '../../../src/agent/agent.ts';
import type { ToolEffect } from '../../../src/agent/tools/index.ts';
import type { Household } from '../../../src/db/schema.ts';
import { logCare } from '../../../src/domain/care.ts';
import { ensureMember, type Person } from '../../../src/domain/households.ts';
import { storeTrigger } from '../../../src/domain/messages.ts';
import { addNote } from '../../../src/domain/notes.ts';
import { addPlant } from '../../../src/domain/plants.ts';
import { createLogger } from '../../../src/ops/logger.ts';
import { scriptedModel } from '../../support/scripted-model.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from '../domain/fixtures.ts';

const ctx = useTestDb();
const NOW = Temporal.Instant.from(`${TODAY}T10:00:00Z`);

let household: Household;
let anna: Person;
let chatId: string;
let pothos: string; // p1
let monstera: string; // p2
let triggers = 0;

beforeEach(async () => {
  household = await newHousehold(ctx.db);
  anna = await ensureMember(ctx.db, household.id, {
    channel: 'test',
    identities: [{ externalId: `anna-${household.id}`, idType: 'pn' }],
    displayName: 'Anna',
  });
  chatId = (
    await ctx.db
      .selectFrom('chats')
      .select('id')
      .where('household_id', '=', household.id)
      .executeTakeFirstOrThrow()
  ).id;
  pothos = (
    await addPlant(ctx.db, {
      householdId: household.id,
      name: 'Pothos',
      room: 'living room',
      waterIntervalDays: 7,
      lastWatered: '2026-11-08',
      today: TODAY,
    })
  ).plant.id;
  monstera = (
    await addPlant(ctx.db, {
      householdId: household.id,
      name: 'Monstera',
      room: 'bedroom',
      waterIntervalDays: 9,
      extraTasks: [{ taskType: 'fertilize', intervalDays: 30 }],
      today: '2026-11-01',
    })
  ).plant.id;
});

// Runs one tool call through the agent and returns what it did.
async function call(tool: string, input: Record<string, unknown>): Promise<ToolEffect> {
  const message = await storeTrigger(ctx.db, {
    chatId,
    externalId: `t-${String(++triggers)}`,
    senderPersonId: anna.id,
    body: 'test',
    createdAt: new Date(NOW.epochMilliseconds),
  });
  if (message === undefined) throw new Error('not stored');
  const agent = createAgent({
    db: ctx.db,
    model: scriptedModel([{ calls: [{ tool, input }] }, { text: 'ok' }]),
    logger: createLogger('silent'),
    maxRetries: 0,
  });
  const { effects } = await agent.handle({ household, sender: anna, message, now: NOW });
  const [effect] = effects;
  if (effect === undefined) throw new Error(`${tool} did not run`);
  return effect;
}

function expectRefused(effect: ToolEffect, text: string): void {
  expect(effect.ok).toBe(false);
  expect((effect.result as { error?: string }).error).toContain(text);
}

async function schedule(plantId: string, taskType = 'water') {
  return ctx.db
    .selectFrom('care_schedules')
    .select(['interval_days', 'next_due'])
    .where('plant_id', '=', plantId)
    .where('task_type', '=', taskType as 'water')
    .executeTakeFirst();
}

describe('tools', () => {
  it('add_plant saves the plant, its schedules and a known last watering', async () => {
    const effect = await call('add_plant', {
      name: 'Rosemary',
      room: 'kitchen',
      water_interval_days: 5,
      last_watered: '2026-11-10',
      extra_tasks: [{ task_type: 'prune', interval_days: 60 }],
    });
    expect(effect).toMatchObject({
      ok: true,
      result: {
        saved: 'Rosemary',
        ref: 'p3',
        room: 'kitchen',
        schedules: [
          { task: 'water', every_days: 5, next_due: '2026-11-15' },
          { task: 'prune', every_days: 60, next_due: '2027-01-11' },
        ],
        logged_watering: '2026-11-10',
      },
    });
    const events = await ctx.db
      .selectFrom('care_events')
      .innerJoin('plants', 'plants.id', 'care_events.plant_id')
      .select(['care_events.person_id', 'care_events.source_message_id'])
      .where('plants.name', '=', 'Rosemary')
      .where('plants.household_id', '=', household.id)
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]?.person_id).toBe(anna.id);
  });

  it('add_plant refuses a future last watering', async () => {
    const effect = await call('add_plant', {
      name: 'Fern',
      water_interval_days: 4,
      last_watered: '2026-11-20',
    });
    expectRefused(effect, 'future');
  });

  it('update_plant moves a plant', async () => {
    const effect = await call('update_plant', { plant: 'p1', room: 'kitchen' });
    expect(effect.result).toEqual({
      updated: 'p1',
      name: 'Pothos',
      species: null,
      room: 'kitchen',
    });
  });

  it('archive_plant archives', async () => {
    const effect = await call('archive_plant', { plant: 'p2', reason: 'died' });
    expect(effect.result).toEqual({ archived: 'Monstera' });
    const plant = await ctx.db
      .selectFrom('plants')
      .select(['status', 'archived_reason'])
      .where('id', '=', monstera)
      .executeTakeFirstOrThrow();
    expect(plant).toEqual({ status: 'archived', archived_reason: 'died' });
  });

  it('log_care logs done and skipped by ref', async () => {
    const done = await call('log_care', { plants: ['p1'], task_type: 'water', action: 'done' });
    expect(done.result).toEqual({
      logged: [{ plant: 'Pothos', ref: 'p1', action: 'done', date: TODAY, next_due: '2026-11-19' }],
    });
    const skipped = await call('log_care', {
      plants: ['P2'],
      task_type: 'water',
      action: 'skipped',
      recheck_in_days: 2,
    });
    expect(skipped.result).toMatchObject({
      logged: [{ plant: 'Monstera', next_due: '2026-11-14' }],
    });
  });

  it('log_care with "all" covers plants with a schedule for the task', async () => {
    const effect = await call('log_care', {
      plants: 'all',
      task_type: 'fertilize',
      action: 'done',
    });
    expect(effect.result).toEqual({
      logged: [
        { plant: 'Monstera', ref: 'p2', action: 'done', date: TODAY, next_due: '2026-12-12' },
      ],
    });
  });

  it('log_care asks for recheck days with skipped', async () => {
    const effect = await call('log_care', {
      plants: ['p1'],
      task_type: 'water',
      action: 'skipped',
    });
    expectRefused(effect, 'recheck_in_days');
  });

  it('update_schedule changes the interval from the last done date', async () => {
    const effect = await call('update_schedule', {
      plant: 'p1',
      task_type: 'water',
      interval_days: 10,
    });
    expect(effect.result).toEqual({
      plant: 'Pothos',
      task: 'water',
      every_days: 10,
      next_due: '2026-11-18',
    });
    expect(await schedule(pothos)).toEqual({ interval_days: 10, next_due: '2026-11-18' });
  });

  it('update_schedule creates a missing schedule and refuses a past next_due', async () => {
    const created = await call('update_schedule', {
      plant: 'p1',
      task_type: 'mist',
      interval_days: 3,
      next_due: '2026-11-13',
    });
    expect(created.result).toMatchObject({ task: 'mist', every_days: 3, next_due: '2026-11-13' });
    const past = await call('update_schedule', {
      plant: 'p1',
      task_type: 'water',
      next_due: '2026-11-01',
    });
    expectRefused(past, 'today');
  });

  it('get_history lists past events', async () => {
    await logCare(ctx.db, {
      householdId: household.id,
      plants: [monstera],
      taskType: 'water',
      action: 'skipped',
      recheckInDays: 2,
      today: '2026-11-11',
      personId: anna.id,
    });
    const effect = await call('get_history', { plant: 'p2' });
    expect(effect.result).toEqual({
      events: [
        {
          plant: 'Monstera',
          ref: 'p2',
          task: 'water',
          action: 'skipped',
          date: '2026-11-11',
          recheck_in_days: 2,
          by: 'Anna',
        },
      ],
    });
  });

  it('add_note and resolve_note', async () => {
    const added = await call('add_note', { plant: 'p2', body: 'broken branch' });
    expect(added.result).toEqual({ saved_note: 'broken branch', ref: 'n1', on: 'Monstera' });
    await addNote(ctx.db, { householdId: household.id, body: 'cat chews leaves' });
    // A new call sees the notes in context order: n1 broken branch, n2 cat.
    const resolved = await call('resolve_note', { note: 'n2' });
    expect(resolved.result).toEqual({ resolved: 'cat chews leaves' });
  });

  it('update_settings validates and saves', async () => {
    const effect = await call('update_settings', {
      reminder_time: '8:30',
      timezone: 'europe/warsaw',
    });
    expect(effect.result).toEqual({
      reminder_time: '08:30',
      timezone: 'Europe/Warsaw',
      language: 'en',
    });
    const bad = await call('update_settings', { timezone: 'Mars/Olympus' });
    expectRefused(bad, 'time zone');
  });

  it("can't reach another household's plants", async () => {
    const other = await newHousehold(ctx.db);
    await addPlant(ctx.db, {
      householdId: other.id,
      name: 'Cactus',
      waterIntervalDays: 14,
      today: TODAY,
    });
    const effect = await call('log_care', { plants: ['p3'], task_type: 'water', action: 'done' });
    expectRefused(effect, 'unknown plant ref');
  });
});
