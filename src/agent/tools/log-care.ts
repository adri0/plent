import { tool } from 'ai';
import { z } from 'zod';

import { logCare } from '../../domain/care.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { checkDate, days, isoDate, plantRef, taskType } from './schemas.ts';

export function logCareTool(ctx: ToolContext) {
  return tool({
    description:
      'Log care that was done, or skipped (e.g. soil still wet). Skipped needs recheck_in_days: ' +
      'when to check again. "all" means every active plant with a schedule for that task.',
    inputSchema: z.object({
      plants: z.union([z.literal('all'), z.array(plantRef)]),
      task_type: taskType,
      action: z.enum(['done', 'skipped']),
      date: isoDate.optional().describe('when it happened, YYYY-MM-DD; today if left out'),
      recheck_in_days: days.optional().describe('with skipped only'),
    }),
    execute: (input) =>
      runRecorded(ctx, 'log_care', input, async (db) => {
        const logged = await logCare(db, {
          householdId: ctx.householdId,
          plants:
            input.plants === 'all'
              ? 'all'
              : input.plants.map((ref) => ctx.refs.resolve('plant', ref)),
          taskType: input.task_type,
          action: input.action,
          occurredOn: input.date === undefined ? undefined : checkDate(input.date, 'date'),
          recheckInDays: input.recheck_in_days,
          today: ctx.today,
          personId: ctx.personId,
          sourceMessageId: ctx.messageId,
        });
        return {
          logged: logged.map((l) => ({
            plant: l.plantName,
            ref: ctx.refs.refOf(l.plantId),
            action: l.event.action,
            date: l.event.occurred_on,
            next_due: l.nextDue ?? `no ${input.task_type} schedule`,
          })),
        };
      }),
  });
}
