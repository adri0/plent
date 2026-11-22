import type { ScenarioRun } from '../harness.ts';

// Reads the scenarios check against.

export async function activePlants(run: ScenarioRun) {
  return run.db
    .selectFrom('plants')
    .select(['id', 'name', 'room', 'status'])
    .where('household_id', '=', run.householdId)
    .where('status', '=', 'active')
    .orderBy('created_at')
    .execute();
}

export async function schedulesOf(run: ScenarioRun, plantId: string) {
  return run.db
    .selectFrom('care_schedules')
    .select(['task_type', 'interval_days', 'next_due', 'active'])
    .where('plant_id', '=', plantId)
    .execute();
}

// Care events logged during the conversation (seeded ones have no source message).
export async function newEvents(run: ScenarioRun) {
  return run.db
    .selectFrom('care_events')
    .innerJoin('plants', 'plants.id', 'care_events.plant_id')
    .select([
      'plants.name as plant',
      'care_events.task_type as task',
      'care_events.action as action',
      'care_events.occurred_on as date',
      'care_events.recheck_in_days as recheck',
    ])
    .where('plants.household_id', '=', run.householdId)
    .where('care_events.source_message_id', 'is not', null)
    .orderBy('plants.name')
    .execute();
}

export async function activeNotes(run: ScenarioRun) {
  return run.db
    .selectFrom('plant_notes')
    .leftJoin('plants', 'plants.id', 'plant_notes.plant_id')
    .select(['plant_notes.body as body', 'plants.name as plant'])
    .where('plant_notes.household_id', '=', run.householdId)
    .where('plant_notes.resolved_at', 'is', null)
    .execute();
}

export function questionCount(reply: string): number {
  return (reply.match(/\?/g) ?? []).length;
}
