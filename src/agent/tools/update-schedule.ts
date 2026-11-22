import { tool } from 'ai';
import { z } from 'zod';

import { daysBetween } from '../../domain/dates.ts';
import { DomainError } from '../../domain/errors.ts';
import { getActivePlant, upsertSchedule } from '../../domain/plants.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { checkDate, days, isoDate, plantRef, taskType } from './schemas.ts';

export function updateScheduleTool(ctx: ToolContext) {
  return tool({
    description:
      "Change how often a task is due, or when it's next due; creates the schedule if the plant has none. " +
      'Use it directly when a member asks; a change you suggest yourself needs their yes first.',
    inputSchema: z.object({
      plant: plantRef,
      task_type: taskType,
      interval_days: days.optional(),
      next_due: isoDate.optional().describe('today or later, YYYY-MM-DD'),
    }),
    execute: (input) =>
      runRecorded(ctx, 'update_schedule', input, async (db) => {
        const plantId = ctx.refs.resolve('plant', input.plant);
        let nextDue: string | undefined;
        if (input.next_due !== undefined) {
          nextDue = checkDate(input.next_due, 'next_due');
          if (daysBetween(ctx.today, nextDue) < 0) {
            throw new DomainError(
              'invalid_input',
              `next_due must be today (${ctx.today}) or later`,
            );
          }
        }
        if (input.interval_days === undefined && nextDue === undefined) {
          throw new DomainError('invalid_input', 'give interval_days, next_due or both');
        }
        const schedule = await upsertSchedule(
          db,
          ctx.householdId,
          plantId,
          input.task_type,
          { intervalDays: input.interval_days, nextDue },
          ctx.today,
        );
        const plant = await getActivePlant(db, ctx.householdId, plantId);
        return {
          plant: plant.name,
          task: schedule.task_type,
          every_days: schedule.interval_days,
          next_due: schedule.next_due,
        };
      }),
  });
}
