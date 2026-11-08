import { tool } from 'ai';
import { z } from 'zod';

import { updatePlant } from '../../domain/plants.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { plantRef } from './schemas.ts';

export function updatePlantTool(ctx: ToolContext) {
  return tool({
    description: 'Rename a plant, set its species or move it to another room.',
    inputSchema: z.object({
      plant: plantRef,
      name: z.string().optional(),
      species: z.string().optional(),
      room: z.string().optional(),
    }),
    execute: (input) =>
      runRecorded(ctx, 'update_plant', input, async (db) => {
        const plant = await updatePlant(
          db,
          ctx.householdId,
          ctx.refs.resolve('plant', input.plant),
          {
            name: input.name,
            species: input.species,
            room: input.room,
          },
        );
        return { updated: input.plant, name: plant.name, species: plant.species, room: plant.room };
      }),
  });
}
