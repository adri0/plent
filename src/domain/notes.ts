import type { Db } from '../db/client.ts';
import type { PlantNote } from '../db/schema.ts';
import { DomainError } from './errors.ts';
import { getActivePlant } from './plants.ts';

// Care-relevant notes ("broken branch", "cat chews leaves"). Append-only: resolved, never
// deleted. Capped so the household block stays short; past a cap, the agent resolves or
// consolidates notes first.

export const PLANT_NOTE_CAP = 5; // active notes per plant
export const HOUSEHOLD_NOTE_CAP = 8; // active household-wide notes (no plant)
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
    let count = trx
      .selectFrom('plant_notes')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('household_id', '=', input.householdId)
      .where('resolved_at', 'is', null);
    let cap: number;
    let scope: string;
    if (input.plantId === undefined) {
      count = count.where('plant_id', 'is', null);
      cap = HOUSEHOLD_NOTE_CAP;
      scope = 'household-wide';
    } else {
      const plant = await getActivePlant(trx, input.householdId, input.plantId);
      count = count.where('plant_id', '=', plant.id);
      cap = PLANT_NOTE_CAP;
      scope = `for ${plant.name}`;
    }
    const { n } = await count.executeTakeFirstOrThrow();
    if (Number(n) >= cap) {
      throw new DomainError(
        'note_cap_reached',
        `already ${String(cap)} active notes ${scope}: resolve or merge one first`,
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

// Active notes: household-wide ones and those on active plants, oldest first.
export async function listActiveNotes(db: Db, householdId: string): Promise<PlantNote[]> {
  return db
    .selectFrom('plant_notes')
    .leftJoin('plants', 'plants.id', 'plant_notes.plant_id')
    .selectAll('plant_notes')
    .where('plant_notes.household_id', '=', householdId)
    .where('plant_notes.resolved_at', 'is', null)
    .where((eb) =>
      eb.or([eb('plant_notes.plant_id', 'is', null), eb('plants.status', '=', 'active')]),
    )
    .orderBy('plant_notes.created_at')
    .execute();
}
