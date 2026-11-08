import { addPlantTool } from './add-plant.ts';
import { archivePlantTool } from './archive-plant.ts';
import { getHistoryTool } from './get-history.ts';
import { logCareTool } from './log-care.ts';
import { addNoteTool, resolveNoteTool } from './notes.ts';
import type { ToolContext } from './run.ts';
import { updatePlantTool } from './update-plant.ts';
import { updateScheduleTool } from './update-schedule.ts';
import { updateSettingsTool } from './update-settings.ts';

export type { ToolContext, ToolEffect } from './run.ts';

// The agent's nine tools, bound to one trigger's household and refs.
export function createTools(ctx: ToolContext) {
  return {
    add_plant: addPlantTool(ctx),
    update_plant: updatePlantTool(ctx),
    archive_plant: archivePlantTool(ctx),
    log_care: logCareTool(ctx),
    update_schedule: updateScheduleTool(ctx),
    get_history: getHistoryTool(ctx),
    add_note: addNoteTool(ctx),
    resolve_note: resolveNoteTool(ctx),
    update_settings: updateSettingsTool(ctx),
  };
}

export type AgentTools = ReturnType<typeof createTools>;

// Tools that change the household's data; get_history only reads.
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'add_plant',
  'update_plant',
  'archive_plant',
  'log_care',
  'update_schedule',
  'add_note',
  'resolve_note',
  'update_settings',
]);
