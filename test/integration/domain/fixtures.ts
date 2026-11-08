import { randomUUID } from 'node:crypto';

import type { Db } from '../../../src/db/client.ts';
import type { Household } from '../../../src/db/schema.ts';
import { ensureChat } from '../../../src/domain/households.ts';

export const TODAY = '2026-11-12';

// A fresh active household with its own group chat.
export async function newHousehold(db: Db): Promise<Household> {
  const { household } = await ensureChat(db, {
    channel: 'test',
    externalId: `group-${randomUUID()}`,
    kind: 'group',
  });
  return db
    .updateTable('households')
    .set({ status: 'active', activated_at: new Date() })
    .where('id', '=', household.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}
