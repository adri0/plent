import { describe, expect, it } from 'vitest';

import type { Household } from '../../../src/db/schema.ts';
import { getHistory, logCare } from '../../../src/domain/care.ts';
import { ensurePerson } from '../../../src/domain/households.ts';
import { addPlant, archivePlant, listSchedules } from '../../../src/domain/plants.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from './fixtures.ts';

const t = useTestDb();

async function withPlants(): Promise<{ h: Household; pothos: string; monstera: string }> {
  const h = await newHousehold(t.db);
  const pothos = await addPlant(t.db, {
    householdId: h.id,
    name: 'Pothos',
    waterIntervalDays: 7,
    lastWatered: '2026-11-08',
    extraTasks: [{ taskType: 'fertilize', intervalDays: 30 }],
    today: TODAY,
  });
  const monstera = await addPlant(t.db, {
    householdId: h.id,
    name: 'Monstera',
    waterIntervalDays: 9,
    lastWatered: '2026-11-03',
    today: TODAY,
  });
  return { h, pothos: pothos.plant.id, monstera: monstera.plant.id };
}

async function nextDue(householdId: string, plantId: string, task = 'water'): Promise<string> {
  const schedule = (await listSchedules(t.db, householdId)).find(
    (s) => s.plant_id === plantId && s.task_type === task,
  );
  if (schedule === undefined) throw new Error('no schedule');
  return schedule.next_due;
}

describe('logging care', () => {
  it('logs done and skipped together, as in "did the pothos, monstera still wet"', async () => {
    const { h, pothos, monstera } = await withPlants();
    const done = await logCare(t.db, {
      householdId: h.id,
      plants: [pothos],
      taskType: 'water',
      action: 'done',
      today: TODAY,
    });
    const skipped = await logCare(t.db, {
      householdId: h.id,
      plants: [monstera],
      taskType: 'water',
      action: 'skipped',
      recheckInDays: 2,
      today: TODAY,
    });
    expect(done).toMatchObject([{ plantName: 'Pothos', nextDue: '2026-11-19' }]);
    expect(skipped).toMatchObject([
      { plantName: 'Monstera', nextDue: '2026-11-14', event: { recheck_in_days: 2 } },
    ]);
    expect(await nextDue(h.id, pothos)).toBe('2026-11-19');
    expect(await nextDue(h.id, monstera)).toBe('2026-11-14');
  });

  it('logs "all" for every active plant with that task, as in "fertilized everything"', async () => {
    const { h, pothos } = await withPlants();
    const logged = await logCare(t.db, {
      householdId: h.id,
      plants: 'all',
      taskType: 'fertilize',
      action: 'done',
      today: TODAY,
    });
    expect(logged.map((l) => [l.plantId, l.nextDue])).toEqual([[pothos, '2026-12-12']]);
  });

  it('leaves archived plants out of "all"', async () => {
    const { h, pothos, monstera } = await withPlants();
    await archivePlant(t.db, h.id, monstera, 'gave away');
    const logged = await logCare(t.db, {
      householdId: h.id,
      plants: 'all',
      taskType: 'water',
      action: 'done',
      today: TODAY,
    });
    expect(logged.map((l) => l.plantId)).toEqual([pothos]);
  });

  it('logs a backdated done without moving the schedule back', async () => {
    const { h, pothos } = await withPlants();
    await logCare(t.db, {
      householdId: h.id,
      plants: [pothos],
      taskType: 'water',
      action: 'done',
      occurredOn: '2026-11-05',
      today: TODAY,
    });
    expect(await nextDue(h.id, pothos)).toBe('2026-11-15');
  });

  it('logs care with no schedule as history only', async () => {
    const { h, monstera } = await withPlants();
    const logged = await logCare(t.db, {
      householdId: h.id,
      plants: [monstera],
      taskType: 'rotate',
      action: 'done',
      today: TODAY,
    });
    expect(logged).toMatchObject([{ nextDue: null }]);
  });

  it.each([
    [{ occurredOn: '2026-11-13' }, /in the future/],
    [{ occurredOn: 'yesterday' }, /YYYY-MM-DD/],
    [{ recheckInDays: 2 }, /skipped only/],
    [{ action: 'skipped' as const }, /skipped needs recheck_in_days/],
    [{ action: 'skipped' as const, recheckInDays: 0 }, /1 to 366/],
    [{ action: 'skipped' as const, recheckInDays: 1.5 }, /1 to 366/],
  ])('rejects %o', async (extra, message) => {
    const { h, pothos } = await withPlants();
    await expect(
      logCare(t.db, {
        householdId: h.id,
        plants: [pothos],
        taskType: 'water',
        action: 'done',
        today: TODAY,
        ...extra,
      }),
    ).rejects.toThrow(message);
  });

  it('rejects unknown, foreign and archived plants, and logs nothing', async () => {
    const { h, pothos, monstera } = await withPlants();
    const other = await withPlants();
    await archivePlant(t.db, h.id, monstera);
    const log = (plants: string[]) =>
      logCare(t.db, { householdId: h.id, plants, taskType: 'water', action: 'done', today: TODAY });

    await expect(log([pothos, other.pothos])).rejects.toThrow(/no such plant/);
    await expect(log([pothos, monstera])).rejects.toThrow(/archived/);
    await expect(log([])).rejects.toThrow(/at least one plant/);
    const history = await getHistory(t.db, h.id, { plantId: pothos });
    expect(history.map((e) => e.occurredOn)).toEqual(['2026-11-08']);
  });

  it('rejects "all" when no plant has the task', async () => {
    const { h } = await withPlants();
    await expect(
      logCare(t.db, {
        householdId: h.id,
        plants: 'all',
        taskType: 'mist',
        action: 'done',
        today: TODAY,
      }),
    ).rejects.toThrow(/no active plant has a mist schedule/);
  });
});

describe('care history', () => {
  it('lists events newest first with who did them, archived plants included', async () => {
    const { h, pothos, monstera } = await withPlants();
    const anna = await ensurePerson(t.db, {
      channel: 'test',
      displayName: 'Anna',
      identities: [{ externalId: `anna-${h.id}`, idType: 'pn' }],
    });
    await logCare(t.db, {
      householdId: h.id,
      plants: [pothos],
      taskType: 'water',
      action: 'done',
      personId: anna.id,
      today: TODAY,
    });
    await archivePlant(t.db, h.id, monstera, 'died');

    const history = await getHistory(t.db, h.id);
    expect(history.map((e) => [e.plantName, e.occurredOn, e.personName])).toEqual([
      ['Pothos', '2026-11-12', 'Anna'],
      ['Pothos', '2026-11-08', null],
      ['Monstera', '2026-11-03', null],
    ]);
    expect(await getHistory(t.db, h.id, { plantId: monstera })).toHaveLength(1);
    expect(await getHistory(t.db, h.id, { taskType: 'fertilize' })).toEqual([]);
    expect(await getHistory(t.db, h.id, { limit: 1 })).toHaveLength(1);
  });
});
