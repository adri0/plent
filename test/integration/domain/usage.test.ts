import { describe, expect, it } from 'vitest';

import { checkDailyCap, recordUsage } from '../../../src/domain/usage.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from './fixtures.ts';

const t = useTestDb();

describe('usage', () => {
  it('adds up requests and tokens per household and day', async () => {
    const h = await newHousehold(t.db);
    await recordUsage(t.db, h.id, TODAY, { inputTokens: 1200, outputTokens: 80 });
    await recordUsage(t.db, h.id, TODAY, { requests: 2, inputTokens: 2500, outputTokens: 150 });
    await recordUsage(t.db, h.id, '2026-11-13', { inputTokens: 900, outputTokens: 40 });

    const rows = await t.db
      .selectFrom('llm_usage')
      .select(['day', 'requests', 'input_tokens', 'output_tokens'])
      .where('household_id', '=', h.id)
      .orderBy('day')
      .execute();
    expect(rows).toEqual([
      { day: TODAY, requests: 3, input_tokens: 3700, output_tokens: 230 },
      { day: '2026-11-13', requests: 1, input_tokens: 900, output_tokens: 40 },
    ]);
  });

  it("counts requests against the household's daily cap", async () => {
    const h = await newHousehold(t.db);
    await t.db.updateTable('households').set({ daily_llm_cap: 3 }).where('id', '=', h.id).execute();
    expect(await checkDailyCap(t.db, h.id, TODAY)).toEqual({ used: 0, cap: 3, reached: false });

    await recordUsage(t.db, h.id, TODAY, { requests: 2, inputTokens: 10, outputTokens: 10 });
    expect(await checkDailyCap(t.db, h.id, TODAY)).toEqual({ used: 2, cap: 3, reached: false });

    await recordUsage(t.db, h.id, TODAY, { inputTokens: 10, outputTokens: 10 });
    expect(await checkDailyCap(t.db, h.id, TODAY)).toEqual({ used: 3, cap: 3, reached: true });
    // A new local day starts from zero.
    expect(await checkDailyCap(t.db, h.id, '2026-11-13')).toMatchObject({ reached: false });
  });
});
