import { sql } from 'kysely';

import type { Db } from '../db/client.ts';
import type { IsoDate } from './dates.ts';

// Model usage per household per local day, and the daily cap on model requests.

export interface UsageDelta {
  requests?: number | undefined; // model requests (agent steps); 1 by default
  inputTokens: number;
  outputTokens: number;
}

export async function recordUsage(
  db: Db,
  householdId: string,
  day: IsoDate,
  delta: UsageDelta,
): Promise<void> {
  const requests = delta.requests ?? 1;
  await db
    .insertInto('llm_usage')
    .values({
      household_id: householdId,
      day,
      requests,
      input_tokens: delta.inputTokens,
      output_tokens: delta.outputTokens,
    })
    .onConflict((oc) =>
      oc.columns(['household_id', 'day']).doUpdateSet({
        requests: sql`llm_usage.requests + excluded.requests`,
        input_tokens: sql`llm_usage.input_tokens + excluded.input_tokens`,
        output_tokens: sql`llm_usage.output_tokens + excluded.output_tokens`,
      }),
    )
    .execute();
}

export interface CapStatus {
  used: number;
  cap: number;
  reached: boolean;
}

// Whether the household has used up today's model requests (`households.daily_llm_cap`).
export async function checkDailyCap(db: Db, householdId: string, day: IsoDate): Promise<CapStatus> {
  const row = await db
    .selectFrom('households')
    .leftJoin('llm_usage', (join) =>
      join.onRef('llm_usage.household_id', '=', 'households.id').on('llm_usage.day', '=', day),
    )
    .select(['households.daily_llm_cap as cap', 'llm_usage.requests as used'])
    .where('households.id', '=', householdId)
    .executeTakeFirstOrThrow();
  const used = row.used ?? 0;
  return { used, cap: row.cap, reached: used >= row.cap };
}
