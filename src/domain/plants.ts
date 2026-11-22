import { inTransaction, type Db } from '../db/client.ts';
import type { CareSchedule, Plant, TaskType } from '../db/schema.ts';
import { daysBetween, type IsoDate } from './dates.ts';
import { DomainError } from './errors.ts';
import { firstDue, nextDueAfterIntervalChange } from './schedule.ts';

// Plants and their care schedules. Every query is scoped to one household: a plant id from
// another household is "not found".

export const TASK_TYPES: readonly TaskType[] = [
  'water',
  'fertilize',
  'mist',
  'repot',
  'rotate',
  'prune',
];

export interface NewPlantInput {
  householdId: string;
  name: string;
  species?: string | undefined;
  room?: string | undefined;
  waterIntervalDays: number;
  lastWatered?: IsoDate | undefined;
  extraTasks?: { taskType: TaskType; intervalDays: number }[] | undefined;
  today: IsoDate;
  personId?: string | undefined;
  sourceMessageId?: string | undefined;
}

// Adds a plant with its watering schedule and any extra tasks. A known last watering is
// logged as a `done` event, so the schedule and the history agree.
export async function addPlant(
  db: Db,
  input: NewPlantInput,
): Promise<{ plant: Plant; schedules: CareSchedule[] }> {
  checkInterval(input.waterIntervalDays);
  if (input.lastWatered !== undefined) checkNotFuture(input.lastWatered, input.today);
  const tasks = new Map<TaskType, number>([['water', input.waterIntervalDays]]);
  for (const task of input.extraTasks ?? []) {
    if (task.taskType === 'water') {
      throw new DomainError('invalid_input', 'water is set with water_interval_days');
    }
    checkInterval(task.intervalDays);
    tasks.set(task.taskType, task.intervalDays);
  }

  return inTransaction(db, async (trx) => {
    const plant = await trx
      .insertInto('plants')
      .values({
        household_id: input.householdId,
        name: input.name.trim(),
        species: input.species?.trim() ?? null,
        room: input.room?.trim() ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const schedules = await trx
      .insertInto('care_schedules')
      .values(
        [...tasks].map(([taskType, intervalDays]) => ({
          plant_id: plant.id,
          task_type: taskType,
          interval_days: intervalDays,
          next_due: firstDue(
            input.today,
            intervalDays,
            taskType === 'water' ? input.lastWatered : undefined,
          ),
        })),
      )
      .returningAll()
      .execute();

    if (input.lastWatered !== undefined) {
      await trx
        .insertInto('care_events')
        .values({
          plant_id: plant.id,
          person_id: input.personId ?? null,
          task_type: 'water',
          action: 'done',
          occurred_on: input.lastWatered,
          source_message_id: input.sourceMessageId ?? null,
        })
        .execute();
    }
    return { plant, schedules };
  });
}

export interface PlantChanges {
  name?: string | undefined;
  species?: string | undefined;
  room?: string | undefined;
}

// Renames a plant or moves it to another room.
export async function updatePlant(
  db: Db,
  householdId: string,
  plantId: string,
  changes: PlantChanges,
): Promise<Plant> {
  await getActivePlant(db, householdId, plantId);
  const set = {
    ...(changes.name === undefined ? {} : { name: changes.name.trim() }),
    ...(changes.species === undefined ? {} : { species: changes.species.trim() || null }),
    ...(changes.room === undefined ? {} : { room: changes.room.trim() || null }),
  };
  if (Object.keys(set).length === 0) {
    throw new DomainError('invalid_input', 'nothing to change: give a name, species or room');
  }
  return db
    .updateTable('plants')
    .set(set)
    .where('id', '=', plantId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

// Archives a plant ("the rosemary died"). Its schedules, events and notes stay as history.
export async function archivePlant(
  db: Db,
  householdId: string,
  plantId: string,
  reason?: string,
  now: Date = new Date(),
): Promise<Plant> {
  await getActivePlant(db, householdId, plantId);
  return db
    .updateTable('plants')
    .set({ status: 'archived', archived_reason: reason?.trim() ?? null, archived_at: now })
    .where('id', '=', plantId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getActivePlant(db: Db, householdId: string, plantId: string): Promise<Plant> {
  const plant = await db
    .selectFrom('plants')
    .selectAll()
    .where('id', '=', plantId)
    .where('household_id', '=', householdId)
    .executeTakeFirst();
  if (plant === undefined) throw new DomainError('not_found', 'no such plant in this household');
  if (plant.status === 'archived') {
    throw new DomainError('plant_archived', `${plant.name} is archived`);
  }
  return plant;
}

export async function listActivePlants(db: Db, householdId: string): Promise<Plant[]> {
  return db
    .selectFrom('plants')
    .selectAll()
    .where('household_id', '=', householdId)
    .where('status', '=', 'active')
    .orderBy('created_at')
    .execute();
}

export async function listSchedules(db: Db, householdId: string): Promise<CareSchedule[]> {
  return db
    .selectFrom('care_schedules')
    .innerJoin('plants', 'plants.id', 'care_schedules.plant_id')
    .selectAll('care_schedules')
    .where('plants.household_id', '=', householdId)
    .where('plants.status', '=', 'active')
    .where('care_schedules.active', '=', true)
    .orderBy('plants.created_at')
    .orderBy('care_schedules.task_type')
    .execute();
}

export interface ScheduleChanges {
  intervalDays?: number | undefined;
  nextDue?: IsoDate | undefined;
}

// Creates or changes a plant's schedule for one task. A new interval moves `next_due` to the
// last done date plus that interval; an explicit `nextDue` wins over that.
export async function upsertSchedule(
  db: Db,
  householdId: string,
  plantId: string,
  taskType: TaskType,
  changes: ScheduleChanges,
  today: IsoDate,
): Promise<CareSchedule> {
  if (changes.intervalDays !== undefined) checkInterval(changes.intervalDays);
  await getActivePlant(db, householdId, plantId);
  const lastDone = await lastDoneOn(db, plantId, taskType);
  const existing = await db
    .selectFrom('care_schedules')
    .selectAll()
    .where('plant_id', '=', plantId)
    .where('task_type', '=', taskType)
    .executeTakeFirst();

  if (existing === undefined) {
    if (changes.intervalDays === undefined) {
      throw new DomainError('schedule_missing', `no ${taskType} schedule yet: give interval_days`);
    }
    return db
      .insertInto('care_schedules')
      .values({
        plant_id: plantId,
        task_type: taskType,
        interval_days: changes.intervalDays,
        next_due: changes.nextDue ?? firstDue(today, changes.intervalDays, lastDone),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const intervalDays = changes.intervalDays ?? existing.interval_days;
  const nextDue =
    changes.nextDue ??
    (changes.intervalDays === undefined
      ? existing.next_due
      : nextDueAfterIntervalChange(today, intervalDays, lastDone));
  return db
    .updateTable('care_schedules')
    .set({ interval_days: intervalDays, next_due: nextDue, active: true, updated_at: new Date() })
    .where('id', '=', existing.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface DueItem {
  scheduleId: string;
  plantId: string;
  plantName: string;
  room: string | null;
  taskType: TaskType;
  nextDue: IsoDate;
  daysOverdue: number; // 0 when due today
}

// What's due on a household's local date: active schedules on active plants with
// `next_due` on or before it, grouped by task, then most overdue first.
export async function listDue(db: Db, householdId: string, localDate: IsoDate): Promise<DueItem[]> {
  const rows = await db
    .selectFrom('care_schedules')
    .innerJoin('plants', 'plants.id', 'care_schedules.plant_id')
    .select([
      'care_schedules.id as scheduleId',
      'plants.id as plantId',
      'plants.name as plantName',
      'plants.room as room',
      'care_schedules.task_type as taskType',
      'care_schedules.next_due as nextDue',
    ])
    .where('plants.household_id', '=', householdId)
    .where('plants.status', '=', 'active')
    .where('care_schedules.active', '=', true)
    .where('care_schedules.next_due', '<=', localDate)
    .orderBy('care_schedules.task_type')
    .orderBy('care_schedules.next_due')
    .orderBy('plants.name')
    .execute();
  return rows.map((r) => ({ ...r, daysOverdue: daysBetween(r.nextDue, localDate) }));
}

export async function lastDoneOn(
  db: Db,
  plantId: string,
  taskType: TaskType,
): Promise<IsoDate | undefined> {
  const row = await db
    .selectFrom('care_events')
    .select((eb) => eb.fn.max('occurred_on').as('last'))
    .where('plant_id', '=', plantId)
    .where('task_type', '=', taskType)
    .where('action', '=', 'done')
    .executeTakeFirst();
  return row?.last ?? undefined;
}

function checkInterval(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new DomainError('invalid_input', 'interval_days must be a whole number from 1 to 366');
  }
}

export function checkNotFuture(date: IsoDate, today: IsoDate): void {
  if (daysBetween(today, date) > 0) {
    throw new DomainError('invalid_input', `${date} is in the future; today is ${today}`);
  }
}
