import { tool } from 'ai';
import { z } from 'zod';

import { getHistory } from '../../domain/care.ts';
import { runRecorded, type ToolContext } from './run.ts';
import { plantRef, taskType } from './schemas.ts';

export function getHistoryTool(ctx: ToolContext) {
  return tool({
    description: 'Past care events, newest first, e.g. "when did we last fertilize the fern?".',
    inputSchema: z.object({
      plant: plantRef.optional(),
      task_type: taskType.optional(),
      limit: z.number().optional().describe('at most this many events, 20 by default'),
    }),
    // Reads only, but recorded too, so call indexes stay in step on a retry.
    execute: (input) =>
      runRecorded(ctx, 'get_history', input, async (db) => {
        const events = await getHistory(db, ctx.householdId, {
          plantId: input.plant === undefined ? undefined : ctx.refs.resolve('plant', input.plant),
          taskType: input.task_type,
          limit: input.limit,
        });
        return {
          events: events.map((e) => ({
            plant: e.plantName,
            ref: ctx.refs.refOf(e.plantId) ?? 'archived',
            task: e.taskType,
            action: e.action,
            date: e.occurredOn,
            ...(e.recheckInDays === null ? {} : { recheck_in_days: e.recheckInDays }),
            ...(e.personName === null ? {} : { by: e.personName }),
          })),
        };
      }),
  });
}
