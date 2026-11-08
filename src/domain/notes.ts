import type { Db } from '../db/client.ts';
import type { PlantNote } from '../db/schema.ts';
import { DomainError } from './errors.ts';
import { getActivePlant } from './plants.ts';

// Care-relevant notes ("broken branch", "cat chews leaves"). Append-only: resolved, never
// deleted. Capped so the household block stays short; past a cap, the agent resolves or
// consolidates notes first.

export const HOUSEHOLD_NOTE_CAP = 25; // active notes in a household, with or without a plant
export const PLANT_NOTE_CAP = 5; // active notes on one plant
const MAX_BODY_LENGTH = 300;

export interface NewNoteInput {
  householdId: string;
  plantId?: string | undefined; // none: a household-wide note
  body: string;
  createdBy?: string | undefined;
  sourceMessageId?: string | undefined;
}

export async function addNote(db: Db, input: NewNoteInput): Promise<PlantNote> {
  const body = input.body.trim();
  if (body === '') throw new DomainError('invalid_input', 'a note needs some text');
  if (body.length > MAX_BODY_LENGTH) {
    throw new DomainError(
      'invalid_input',
      `keep notes under ${String(MAX_BODY_LENGTH)} characters`,
    );
  }

  return db.transaction().execute(async (trx) => {
    const plant =
      input.plantId === undefined
        ? undefined
        : await getActivePlant(trx, input.householdId, input.plantId);
    const total = await countActiveNotes(trx, input.householdId);
    if (total >= HOUSEHOLD_NOTE_CAP) {
      throw new DomainError(
        'note_cap_reached',
        `already ${String(HOUSEHOLD_NOTE_CAP)} active notes in this household: resolve or merge one first`,
      );
    }
    if (
      plant !== undefined &&
      (await countActiveNotes(trx, input.householdId, plant.id)) >= PLANT_NOTE_CAP
    ) {
      throw new DomainError(
        'note_cap_reached',
        `already ${String(PLANT_NOTE_CAP)} active notes for ${plant.name}: resolve or merge one first`,
      );
    }

    return trx
      .insertInto('plant_notes')
      .values({
        household_id: input.householdId,
        plant_id: input.plantId ?? null,
        body,
        created_by: input.createdBy ?? null,
        source_message_id: input.sourceMessageId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function resolveNote(
  db: Db,
  householdId: string,
  noteId: string,
  now: Date = new Date(),
): Promise<PlantNote> {
  const note = await db
    .updateTable('plant_notes')
    .set({ resolved_at: now })
    .where('id', '=', noteId)
    .where('household_id', '=', householdId)
    .where('resolved_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
  if (note === undefined) throw new DomainError('not_found', 'no such open note in this household');
  return note;
}

// Active notes: unresolved, on the household or on one of its active plants (notes on
// archived plants are history), oldest first.
export async function listActiveNotes(db: Db, householdId: string): Promise<PlantNote[]> {
  return activeNotes(db, householdId)
    .selectAll('plant_notes')
    .orderBy('plant_notes.created_at')
    .execute();
}

async function countActiveNotes(db: Db, householdId: string, plantId?: string): Promise<number> {
  let query = activeNotes(db, householdId).select((eb) => eb.fn.countAll<string>().as('n'));
  if (plantId !== undefined) query = query.where('plant_notes.plant_id', '=', plantId);
  const { n } = await query.executeTakeFirstOrThrow();
  return Number(n);
}

function activeNotes(db: Db, householdId: string) {
  return db
    .selectFrom('plant_notes')
    .leftJoin('plants', 'plants.id', 'plant_notes.plant_id')
    .where('plant_notes.household_id', '=', householdId)
    .where('plant_notes.resolved_at', 'is', null)
    .where((eb) =>
      eb.or([eb('plant_notes.plant_id', 'is', null), eb('plants.status', '=', 'active')]),
    );
}
