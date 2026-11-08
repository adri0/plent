import { describe, expect, it } from 'vitest';

import { DomainError } from '../../../src/domain/errors.ts';
import {
  addPlant,
  archivePlant,
  getActivePlant,
  listActivePlants,
  listDue,
  listSchedules,
  updatePlant,
  upsertSchedule,
} from '../../../src/domain/plants.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from './fixtures.ts';

const t = useTestDb();

describe('plants', () => {
  it('adds a plant with a watering schedule from its last watering, logged as done', async () => {
    const h = await newHousehold(t.db);
    const { plant, schedules } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Pothos',
      room: 'living room',
      waterIntervalDays: 7,
      lastWatered: '2026-11-08',
      today: TODAY,
    });
    expect(plant).toMatchObject({ name: 'Pothos', room: 'living room', status: 'active' });
    expect(schedules).toMatchObject([
      { task_type: 'water', interval_days: 7, next_due: '2026-11-15' },
    ]);

    const events = await t.db
      .selectFrom('care_events')
      .selectAll()
      .where('plant_id', '=', plant.id)
      .execute();
    expect(events).toMatchObject([
      { task_type: 'water', action: 'done', occurred_on: '2026-11-08' },
    ]);
  });

  it('starts from today without a last watering, and adds extra tasks', async () => {
    const h = await newHousehold(t.db);
    const { schedules } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Monstera',
      waterIntervalDays: 9,
      extraTasks: [{ taskType: 'fertilize', intervalDays: 30 }],
      today: TODAY,
    });
    expect(schedules.map((s) => [s.task_type, s.next_due])).toEqual([
      ['water', '2026-11-21'],
      ['fertilize', '2026-12-12'],
    ]);
  });

  it.each([
    [{ waterIntervalDays: 0 }, /interval_days/],
    [{ waterIntervalDays: 2.5 }, /interval_days/],
    [{ waterIntervalDays: 7, lastWatered: '2026-11-13' }, /in the future/],
    [
      { waterIntervalDays: 7, extraTasks: [{ taskType: 'water' as const, intervalDays: 3 }] },
      /water/,
    ],
  ])('rejects %o', async (input, message) => {
    const h = await newHousehold(t.db);
    await expect(
      addPlant(t.db, { householdId: h.id, name: 'Fern', today: TODAY, ...input }),
    ).rejects.toThrow(message);
  });

  it('renames and moves a plant', async () => {
    const h = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Pothos',
      waterIntervalDays: 7,
      today: TODAY,
    });
    const updated = await updatePlant(t.db, h.id, plant.id, {
      name: 'Golden pothos',
      room: 'kitchen',
    });
    expect(updated).toMatchObject({ name: 'Golden pothos', room: 'kitchen' });
  });

  it('archives a plant, keeping it but leaving it out of the active list', async () => {
    const h = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Rosemary',
      waterIntervalDays: 4,
      today: TODAY,
    });
    const archived = await archivePlant(t.db, h.id, plant.id, 'died');
    expect(archived).toMatchObject({ status: 'archived', archived_reason: 'died' });
    expect(archived.archived_at).toBeInstanceOf(Date);
    expect(await listActivePlants(t.db, h.id)).toEqual([]);
    await expect(getActivePlant(t.db, h.id, plant.id)).rejects.toThrow(/archived/);
    await expect(updatePlant(t.db, h.id, plant.id, { room: 'balcony' })).rejects.toThrow(
      DomainError,
    );
  });

  it("can't see or change another household's plants", async () => {
    const mine = await newHousehold(t.db);
    const theirs = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: theirs.id,
      name: 'Cactus',
      waterIntervalDays: 21,
      today: TODAY,
    });
    await expect(updatePlant(t.db, mine.id, plant.id, { name: 'Mine now' })).rejects.toThrow(
      /no such plant/,
    );
    await expect(archivePlant(t.db, mine.id, plant.id)).rejects.toThrow(/no such plant/);
    await expect(
      upsertSchedule(t.db, mine.id, plant.id, 'water', { intervalDays: 1 }, TODAY),
    ).rejects.toThrow(/no such plant/);
  });
});

describe('care schedules', () => {
  it('moves next_due on an interval change to the last done date plus the new interval', async () => {
    const h = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Pothos',
      waterIntervalDays: 7,
      lastWatered: '2026-11-08',
      today: TODAY,
    });
    const schedule = await upsertSchedule(
      t.db,
      h.id,
      plant.id,
      'water',
      { intervalDays: 10 },
      TODAY,
    );
    expect(schedule).toMatchObject({ interval_days: 10, next_due: '2026-11-18' });
  });

  it('uses today plus the new interval when the task was never done', async () => {
    const h = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Pothos',
      waterIntervalDays: 7,
      today: TODAY,
    });
    const schedule = await upsertSchedule(
      t.db,
      h.id,
      plant.id,
      'water',
      { intervalDays: 5 },
      TODAY,
    );
    expect(schedule.next_due).toBe('2026-11-17');
  });

  it('takes an explicit next_due over the rule', async () => {
    const h = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Pothos',
      waterIntervalDays: 7,
      today: TODAY,
    });
    const schedule = await upsertSchedule(
      t.db,
      h.id,
      plant.id,
      'water',
      { intervalDays: 5, nextDue: '2026-11-14' },
      TODAY,
    );
    expect(schedule).toMatchObject({ interval_days: 5, next_due: '2026-11-14' });
  });

  it('creates a missing schedule, which needs an interval', async () => {
    const h = await newHousehold(t.db);
    const { plant } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Fern',
      waterIntervalDays: 5,
      today: TODAY,
    });
    await expect(upsertSchedule(t.db, h.id, plant.id, 'mist', {}, TODAY)).rejects.toThrow(
      /interval_days/,
    );
    const mist = await upsertSchedule(t.db, h.id, plant.id, 'mist', { intervalDays: 2 }, TODAY);
    expect(mist).toMatchObject({ task_type: 'mist', next_due: '2026-11-14' });
    expect((await listSchedules(t.db, h.id)).map((s) => s.task_type).sort()).toEqual([
      'mist',
      'water',
    ]);
  });

  it('lists what is due by local date, grouped by task, overdue first, active plants only', async () => {
    const h = await newHousehold(t.db);
    const add = (name: string, lastWatered: string, room?: string) =>
      addPlant(t.db, {
        householdId: h.id,
        name,
        room,
        waterIntervalDays: 7,
        lastWatered,
        today: TODAY,
      });
    await add('Pothos', '2026-11-05', 'living room'); // due 11-12, today
    await add('Monstera', '2026-11-03', 'bedroom'); // due 11-10, 2 days overdue
    await add('Calathea', '2026-11-08'); // due 11-15, not yet
    const { plant: dead } = await add('Rosemary', '2026-11-01'); // overdue, but archived
    await archivePlant(t.db, h.id, dead.id, 'died');
    const { plant: fertilized } = await addPlant(t.db, {
      householdId: h.id,
      name: 'Lemon tree',
      waterIntervalDays: 3,
      lastWatered: '2026-11-11', // water due 11-14, not yet
      extraTasks: [{ taskType: 'fertilize', intervalDays: 14 }],
      today: TODAY,
    });
    await upsertSchedule(
      t.db,
      h.id,
      fertilized.id,
      'fertilize',
      { intervalDays: 14, nextDue: TODAY },
      TODAY,
    );

    const due = await listDue(t.db, h.id, TODAY);
    expect(due.map((d) => [d.taskType, d.plantName, d.daysOverdue])).toEqual([
      ['fertilize', 'Lemon tree', 0],
      ['water', 'Monstera', 2],
      ['water', 'Pothos', 0],
    ]);
    expect(await listDue(t.db, h.id, '2026-11-09')).toEqual([]);
  });
});
