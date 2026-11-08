import { tool } from 'ai';
import { z } from 'zod';

import { addPlant } from '../../domain/plants.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { checkDate, days, isoDate, taskType } from './schemas.ts';

export function addPlantTool(ctx: ToolContext) {
  return tool({
    description:
      'Add a plant with its watering interval from your plant knowledge, plus any other regular care. ' +
      'Give last_watered when known: it is logged as done and sets the next watering.',
    inputSchema: z.object({
      name: z.string().describe('what the household calls it, e.g. "Pothos" or "big monstera"'),
      species: z.string().optional(),
      room: z.string().optional(),
      water_interval_days: days,
      last_watered: isoDate.optional(),
      extra_tasks: z
        .array(z.object({ task_type: taskType, interval_days: days }))
        .optional()
        .describe('other regular care, e.g. fertilize every 30 days'),
    }),
    execute: (input) =>
      runRecorded(ctx, 'add_plant', input, async (db) => {
        const { plant, schedules } = await addPlant(db, {
          householdId: ctx.householdId,
          name: input.name,
          species: input.species,
          room: input.room,
          waterIntervalDays: input.water_interval_days,
          lastWatered:
            input.last_watered === undefined
              ? undefined
              : checkDate(input.last_watered, 'last_watered'),
          extraTasks: input.extra_tasks?.map((t) => ({
            taskType: t.task_type,
            intervalDays: t.interval_days,
          })),
          today: ctx.today,
          personId: ctx.personId,
          sourceMessageId: ctx.messageId,
        });
        return {
          saved: plant.name,
          ref: ctx.refs.add('plant', plant.id),
          room: plant.room,
          schedules: schedules.map((s) => ({
            task: s.task_type,
            every_days: s.interval_days,
            next_due: s.next_due,
          })),
          ...(input.last_watered === undefined ? {} : { logged_watering: input.last_watered }),
        };
      }),
  });
}
