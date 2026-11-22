import { isDeepStrictEqual } from 'node:util';

import { inTransaction, type Db } from '../../db/client.ts';
import type { IsoDate } from '../../domain/dates.ts';
import { DomainError } from '../../domain/errors.ts';
import type { RefMap } from '../refs.ts';

// What every tool runs with: the household comes from here, never from the model.
export interface ToolContext {
  db: Db;
  householdId: string;
  personId: string;
  messageId: string; // the trigger; tool calls are recorded against it
  today: IsoDate; // the household's local date
  refs: RefMap;
  effects: ToolEffect[]; // every call, in order, for the caller and the evals
  nextCallIndex: number;
}

export interface ToolEffect {
  tool: string;
  args: unknown;
  result: unknown;
  ok: boolean; // false when the tool refused (the model saw the error)
  replayed: boolean; // true when a retry replayed a recorded call instead of running it
}

export type ToolResult = Record<string, unknown>;

// Runs one tool call exactly once per trigger. A call recorded in `tool_calls` at the same
// index, with the same tool and arguments, is replayed from its stored result; otherwise the
// call runs, and its effects and record commit in one transaction. A broken rule comes back
// to the model as `{ error }` so it can fix its input.
export async function runRecorded(
  ctx: ToolContext,
  tool: string,
  args: unknown,
  run: (db: Db) => Promise<ToolResult>,
): Promise<ToolResult> {
  const index = ctx.nextCallIndex++;
  const plainArgs: unknown = JSON.parse(JSON.stringify(args));

  const prior = await ctx.db
    .selectFrom('tool_calls')
    .select(['tool', 'args', 'result'])
    .where('message_id', '=', ctx.messageId)
    .where('call_index', '=', index)
    .executeTakeFirst();
  if (prior !== undefined && prior.tool === tool && isDeepStrictEqual(prior.args, plainArgs)) {
    const result = prior.result as ToolResult;
    ctx.effects.push({ tool, args: plainArgs, result, ok: true, replayed: true });
    return result;
  }

  try {
    const result = await inTransaction(ctx.db, async (trx) => {
      const result = await run(trx);
      const values = {
        tool,
        args: JSON.stringify(plainArgs),
        result: JSON.stringify(result),
      };
      await trx
        .insertInto('tool_calls')
        .values({ message_id: ctx.messageId, call_index: index, ...values })
        .onConflict((oc) => oc.columns(['message_id', 'call_index']).doUpdateSet(values))
        .execute();
      return result;
    });
    ctx.effects.push({ tool, args: plainArgs, result, ok: true, replayed: false });
    return result;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const result = { error: error.message };
    ctx.effects.push({ tool, args: plainArgs, result, ok: false, replayed: false });
    return result;
  }
}
