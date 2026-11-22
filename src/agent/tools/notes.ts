import { tool } from 'ai';
import { z } from 'zod';

import { addNote, resolveNote } from '../../domain/notes.ts';
import { getActivePlant } from '../../domain/plants.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { noteRef, plantRef } from './schemas.ts';

export function addNoteTool(ctx: ToolContext) {
  return tool({
    description:
      'Save a care-relevant note (e.g. "broken branch", "cat chews leaves"). Without a plant it is ' +
      'household-wide. At the cap, resolve or merge an old note first.',
    inputSchema: z.object({
      plant: plantRef.optional(),
      body: z.string().describe('short, under 300 characters'),
    }),
    execute: (input) =>
      runRecorded(ctx, 'add_note', input, async (db) => {
        const plantId =
          input.plant === undefined ? undefined : ctx.refs.resolve('plant', input.plant);
        const note = await addNote(db, {
          householdId: ctx.householdId,
          plantId,
          body: input.body,
          createdBy: ctx.personId,
          sourceMessageId: ctx.messageId,
        });
        const plant =
          plantId === undefined ? undefined : await getActivePlant(db, ctx.householdId, plantId);
        return {
          saved_note: note.body,
          ref: ctx.refs.add('note', note.id),
          on: plant?.name ?? 'household',
        };
      }),
  });
}

export function resolveNoteTool(ctx: ToolContext) {
  return tool({
    description: 'Mark a note as no longer true (the branch healed, the cat moved out).',
    inputSchema: z.object({ note: noteRef }),
    execute: (input) =>
      runRecorded(ctx, 'resolve_note', input, async (db) => {
        const note = await resolveNote(db, ctx.householdId, ctx.refs.resolve('note', input.note));
        return { resolved: note.body };
      }),
  });
}
