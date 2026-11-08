import { describe, expect, it } from 'vitest';

import { createCode, hashCode, redeemCode } from '../../../src/domain/activation.ts';
import { ensureChat, getHousehold } from '../../../src/domain/households.ts';
import { useTestDb } from '../db.ts';

const t = useTestDb();

let chats = 0;
async function pendingHousehold(): Promise<string> {
  chats += 1;
  const { household } = await ensureChat(t.db, {
    channel: 'test',
    externalId: `pending-${String(chats)}`,
    kind: 'group',
  });
  return household.id;
}

const now = new Date('2026-11-12T10:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe('activation codes', () => {
  it('stores only the hash, expiring in 7 days', async () => {
    const { code, expiresAt } = await createCode(t.db, null, now);
    expect(expiresAt).toEqual(days(7));
    const rows = await t.db.selectFrom('activation_codes').selectAll().execute();
    expect(rows.some((r) => r.code_hash === hashCode(code))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('activate a pending household once', async () => {
    const householdId = await pendingHousehold();
    const { code } = await createCode(t.db, null, now);
    expect(await redeemCode(t.db, householdId, code, days(1))).toEqual({ ok: true });

    const household = await getHousehold(t.db, householdId);
    expect(household).toMatchObject({ status: 'active', activated_at: days(1) });
    const row = await t.db
      .selectFrom('activation_codes')
      .selectAll()
      .where('code_hash', '=', hashCode(code))
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ household_id: householdId, used_at: days(1) });

    const other = await pendingHousehold();
    expect(await redeemCode(t.db, other, code, days(1))).toEqual({ ok: false, reason: 'used' });
  });

  it('refuse expired and unknown codes, and leave the household pending', async () => {
    const householdId = await pendingHousehold();
    const { code } = await createCode(t.db, null, now);
    expect(await redeemCode(t.db, householdId, code, days(8))).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await redeemCode(t.db, householdId, 'AAA-222', now)).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect((await getHousehold(t.db, householdId))?.status).toBe('pending');
  });

  it("aren't used up on a household that isn't pending", async () => {
    const householdId = await pendingHousehold();
    const first = await createCode(t.db, null, now);
    await redeemCode(t.db, householdId, first.code, now);
    const second = await createCode(t.db, null, now);
    expect(await redeemCode(t.db, householdId, second.code, now)).toEqual({
      ok: false,
      reason: 'not_pending',
    });
    const row = await t.db
      .selectFrom('activation_codes')
      .select('used_at')
      .where('code_hash', '=', hashCode(second.code))
      .executeTakeFirstOrThrow();
    expect(row.used_at).toBeNull();
  });

  it('activate only one of two households racing for the same code', async () => {
    const [a, b] = [await pendingHousehold(), await pendingHousehold()];
    const { code } = await createCode(t.db, null, now);
    const results = await Promise.all([
      redeemCode(t.db, a, code, now),
      redeemCode(t.db, b, code, now),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
