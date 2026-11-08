import { tool } from 'ai';
import { z } from 'zod';

import { updateSettings } from '../../domain/settings.ts';
import { runRecorded, type ToolContext } from './run.ts';

export function updateSettingsTool(ctx: ToolContext) {
  return tool({
    description: "Change the household's daily reminder time, time zone or language.",
    inputSchema: z.object({
      reminder_time: z.string().optional().describe('HH:MM, 24-hour'),
      timezone: z.string().optional().describe('IANA name, e.g. Europe/Warsaw'),
      language: z.string().optional().describe('two-letter code, e.g. en, pl'),
    }),
    execute: (input) =>
      runRecorded(ctx, 'update_settings', input, async (db) => {
        const household = await updateSettings(db, ctx.householdId, {
          reminderTime: input.reminder_time,
          timezone: input.timezone,
          language: input.language,
        });
        return {
          reminder_time: household.reminder_time.slice(0, 5),
          timezone: household.timezone,
          language: household.language,
        };
      }),
  });
}
