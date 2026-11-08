import { tool } from 'ai';
import { z } from 'zod';

import { archivePlant } from '../../domain/plants.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { plantRef } from './schemas.ts';

export function archivePlantTool(ctx: ToolContext) {
  return tool({
    description:
      'Archive a plant that died or was given away. Its history is kept; it gets no more reminders.',
    inputSchema: z.object({
      plant: plantRef,
      reason: z.string().optional().describe('e.g. "died", "given away"'),
    }),
    execute: (input) =>
      runRecorded(ctx, 'archive_plant', input, async (db) => {
        const plant = await archivePlant(
          db,
          ctx.householdId,
          ctx.refs.resolve('plant', input.plant),
          input.reason,
        );
        return { archived: plant.name };
      }),
  });
}
