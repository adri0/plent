import { describe, expect, it } from 'vitest';

import {
  addNote,
  HOUSEHOLD_NOTE_CAP,
  listActiveNotes,
  PLANT_NOTE_CAP,
  resolveNote,
} from '../../../src/domain/notes.ts';
import { addPlant, archivePlant } from '../../../src/domain/plants.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from './fixtures.ts';

const t = useTestDb();

async function plantIn(householdId: string, name = 'Monstera'): Promise<string> {
  const { plant } = await addPlant(t.db, { householdId, name, waterIntervalDays: 9, today: TODAY });
  return plant.id;
}

describe('notes', () => {
  it('adds plant and household-wide notes', async () => {
    const h = await newHousehold(t.db);
    const plantId = await plantIn(h.id);
    await addNote(t.db, { householdId: h.id, body: 'north-facing flat' });
    await addNote(t.db, { householdId: h.id, plantId, body: '  broken branch  ' });
    const notes = await listActiveNotes(t.db, h.id);
    expect(notes.map((n) => [n.plant_id, n.body])).toEqual([
      [null, 'north-facing flat'],
      [plantId, 'broken branch'],
    ]);
  });

  it(`caps active notes at ${String(PLANT_NOTE_CAP)} per plant`, async () => {
    const h = await newHousehold(t.db);
    const plantId = await plantIn(h.id);
    const notes = [];
    for (let i = 0; i < PLANT_NOTE_CAP; i++) {
      notes.push(await addNote(t.db, { householdId: h.id, plantId, body: `note ${String(i)}` }));
    }
    await expect(addNote(t.db, { householdId: h.id, plantId, body: 'one more' })).rejects.toThrow(
      /already 5 active notes for Monstera/,
    );
    // Other plants and household-wide notes have their own caps.
    await addNote(t.db, { householdId: h.id, plantId: await plantIn(h.id, 'Fern'), body: 'ok' });
    await addNote(t.db, { householdId: h.id, body: 'ok' });

    const first = notes[0];
    if (first === undefined) throw new Error('no notes');
    await resolveNote(t.db, h.id, first.id);
    await addNote(t.db, { householdId: h.id, plantId, body: 'room again' });
  });

  it(`caps active household-wide notes at ${String(HOUSEHOLD_NOTE_CAP)}`, async () => {
    const h = await newHousehold(t.db);
    for (let i = 0; i < HOUSEHOLD_NOTE_CAP; i++) {
      await addNote(t.db, { householdId: h.id, body: `note ${String(i)}` });
    }
    await expect(addNote(t.db, { householdId: h.id, body: 'one more' })).rejects.toThrow(
      /household-wide/,
    );
  });

  it('resolves a note once, keeping it', async () => {
    const h = await newHousehold(t.db);
    const note = await addNote(t.db, { householdId: h.id, body: 'cat chews leaves' });
    const resolved = await resolveNote(t.db, h.id, note.id);
    expect(resolved.resolved_at).toBeInstanceOf(Date);
    expect(await listActiveNotes(t.db, h.id)).toEqual([]);
    await expect(resolveNote(t.db, h.id, note.id)).rejects.toThrow(/no such open note/);
    const kept = await t.db
      .selectFrom('plant_notes')
      .select('id')
      .where('id', '=', note.id)
      .execute();
    expect(kept).toHaveLength(1);
  });

  it("can't add to, resolve or see another household's notes", async () => {
    const mine = await newHousehold(t.db);
    const theirs = await newHousehold(t.db);
    const theirPlant = await plantIn(theirs.id);
    const theirNote = await addNote(t.db, { householdId: theirs.id, body: 'private' });
    await expect(
      addNote(t.db, { householdId: mine.id, plantId: theirPlant, body: 'x' }),
    ).rejects.toThrow(/no such plant/);
    await expect(resolveNote(t.db, mine.id, theirNote.id)).rejects.toThrow(/no such open note/);
    expect(await listActiveNotes(t.db, mine.id)).toEqual([]);
  });

  it('hides notes of archived plants and refuses new ones', async () => {
    const h = await newHousehold(t.db);
    const plantId = await plantIn(h.id);
    await addNote(t.db, { householdId: h.id, plantId, body: 'yellow leaves' });
    await archivePlant(t.db, h.id, plantId, 'died');
    expect(await listActiveNotes(t.db, h.id)).toEqual([]);
    await expect(addNote(t.db, { householdId: h.id, plantId, body: 'x' })).rejects.toThrow(
      /archived/,
    );
  });

  it.each(['', '   ', 'x'.repeat(301)])('rejects the body %j', async (body) => {
    const h = await newHousehold(t.db);
    await expect(addNote(t.db, { householdId: h.id, body })).rejects.toThrow(/note/);
  });
});
