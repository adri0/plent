import type { Db } from '../db/client.ts';
import type { CareAction, CareEvent, TaskType } from '../db/schema.ts';
import { isIsoDate, type IsoDate } from './dates.ts';
import { DomainError } from './errors.ts';
import { checkNotFuture, lastDoneOn } from './plants.ts';
import { nextDueAfterDone, nextDueAfterSkip } from './schedule.ts';

// Care events: "watered the pothos", "monstera soil still wet, skipped". Events are
// append-only; each one moves its plant's schedule for that task by the next_due rules.

export interface LogCareInput {
  householdId: string;
  plants: string[] | 'all'; // plant ids, or every active plant with a schedule for the task
  taskType: TaskType;
  action: CareAction;
  occurredOn?: IsoDate | undefined; // defaults to today
  recheckInDays?: number | undefined; // skipped only
  today: IsoDate;
  personId?: string | undefined;
  sourceMessageId?: string | undefined;
}

export interface LoggedCare {
  plantId: string;
  plantName: string;
  event: CareEvent;
  nextDue: IsoDate | null; // null when the plant has no schedule for the task
}

export async function logCare(db: Db, input: LogCareInput): Promise<LoggedCare[]> {
  const occurredOn = input.occurredOn ?? input.today;
  if (!isIsoDate(occurredOn)) throw new DomainError('invalid_input', 'date must be YYYY-MM-DD');
  checkNotFuture(occurredOn, input.today);
  if (input.recheckInDays !== undefined) {
    if (input.action !== 'skipped') {
      throw new DomainError('invalid_input', 'recheck_in_days goes with skipped only');
    }
    if (!Number.isInteger(input.recheckInDays) || input.recheckInDays < 1) {
      throw new DomainError('invalid_input', 'recheck_in_days must be a whole number of 1 or more');
    }
  }

  return db.transaction().execute(async (trx) => {
    const targets = await findTargets(trx, input);
    const logged: LoggedCare[] = [];
    for (const target of targets) {
      // Read before inserting, so a backdated done compares against the earlier history.
      const previousDone =
        input.action === 'done' ? await lastDoneOn(trx, target.plantId, input.taskType) : undefined;
      const event = await trx
        .insertInto('care_events')
        .values({
          plant_id: target.plantId,
          person_id: input.personId ?? null,
          task_type: input.taskType,
          action: input.action,
          occurred_on: occurredOn,
          recheck_in_days: input.recheckInDays ?? null,
          source_message_id: input.sourceMessageId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      let nextDue: IsoDate | null = null;
      if (target.scheduleId !== null && target.intervalDays !== null) {
        nextDue =
          input.action === 'done'
            ? nextDueAfterDone(occurredOn, target.intervalDays, previousDone)
            : nextDueAfterSkip(input.today, target.intervalDays, input.recheckInDays);
        await trx
          .updateTable('care_schedules')
          .set({ next_due: nextDue, updated_at: new Date() })
          .where('id', '=', target.scheduleId)
          .execute();
      }
      logged.push({ plantId: target.plantId, plantName: target.plantName, event, nextDue });
    }
    return logged;
  });
}

interface Target {
  plantId: string;
  plantName: string;
  scheduleId: string | null;
  intervalDays: number | null;
}

async function findTargets(db: Db, input: LogCareInput): Promise<Target[]> {
  let query = db
    .selectFrom('plants')
    .leftJoin('care_schedules', (join) =>
      join
        .onRef('care_schedules.plant_id', '=', 'plants.id')
        .on('care_schedules.task_type', '=', input.taskType)
        .on('care_schedules.active', '=', true),
    )
    .select([
      'plants.id as plantId',
      'plants.name as plantName',
      'plants.status as status',
      'care_schedules.id as scheduleId',
      'care_schedules.interval_days as intervalDays',
    ])
    .where('plants.household_id', '=', input.householdId)
    .orderBy('plants.created_at');

  if (input.plants === 'all') {
    query = query.where('plants.status', '=', 'active').where('care_schedules.id', 'is not', null);
    const rows = await query.execute();
    if (rows.length === 0) {
      throw new DomainError('schedule_missing', `no active plant has a ${input.taskType} schedule`);
    }
    return rows;
  }

  const ids = [...new Set(input.plants)];
  if (ids.length === 0) throw new DomainError('invalid_input', 'name at least one plant, or "all"');
  const rows = await query.where('plants.id', 'in', ids).execute();
  if (rows.length !== ids.length) {
    throw new DomainError('not_found', 'no such plant in this household');
  }
  const archived = rows.find((r) => r.status === 'archived');
  if (archived !== undefined) {
    throw new DomainError('plant_archived', `${archived.plantName} is archived`);
  }
  return rows;
}

export interface HistoryQuery {
  plantId?: string | undefined;
  taskType?: TaskType | undefined;
  limit?: number | undefined;
}

export interface HistoryEntry {
  plantId: string;
  plantName: string;
  taskType: string;
  action: CareAction;
  occurredOn: IsoDate;
  recheckInDays: number | null;
  personName: string | null;
}

// Past care events, newest first, archived plants included.
export async function getHistory(
  db: Db,
  householdId: string,
  query: HistoryQuery = {},
): Promise<HistoryEntry[]> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  let q = db
    .selectFrom('care_events')
    .innerJoin('plants', 'plants.id', 'care_events.plant_id')
    .leftJoin('people', 'people.id', 'care_events.person_id')
    .select([
      'plants.id as plantId',
      'plants.name as plantName',
      'care_events.task_type as taskType',
      'care_events.action as action',
      'care_events.occurred_on as occurredOn',
      'care_events.recheck_in_days as recheckInDays',
      'people.display_name as personName',
    ])
    .where('plants.household_id', '=', householdId);
  if (query.plantId !== undefined) q = q.where('plants.id', '=', query.plantId);
  if (query.taskType !== undefined) q = q.where('care_events.task_type', '=', query.taskType);
  return q
    .orderBy('care_events.occurred_on', 'desc')
    .orderBy('care_events.created_at', 'desc')
    .limit(limit)
    .execute();
}
