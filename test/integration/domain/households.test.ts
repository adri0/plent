import { describe, expect, it } from 'vitest';

import {
  ensureChat,
  ensureMember,
  ensurePerson,
  listMembers,
} from '../../../src/domain/households.ts';
import { useTestDb } from '../db.ts';

const t = useTestDb();

describe('households and chats', () => {
  it('creates a pending household on first sight of a chat, then reuses it', async () => {
    const chat = { channel: 'whatsapp', externalId: '1203@g.us', kind: 'group' as const };
    const first = await ensureChat(t.db, chat);
    expect(first.created).toBe(true);
    expect(first.household.status).toBe('pending');

    const again = await ensureChat(t.db, chat);
    expect(again).toEqual({ household: first.household, chatId: first.chatId, created: false });
  });

  it('gives each chat its own household', async () => {
    const a = await ensureChat(t.db, { channel: 'whatsapp', externalId: 'a@s', kind: 'dm' });
    const b = await ensureChat(t.db, { channel: 'whatsapp', externalId: 'b@s', kind: 'dm' });
    expect(a.household.id).not.toBe(b.household.id);
  });

  it('survives two first sightings of a chat at once', async () => {
    const chat = { channel: 'whatsapp', externalId: 'race@g.us', kind: 'group' as const };
    const [a, b] = await Promise.all([ensureChat(t.db, chat), ensureChat(t.db, chat)]);
    expect(a.household.id).toBe(b.household.id);
    const households = await t.db
      .selectFrom('chats')
      .select('household_id')
      .where('external_id', '=', 'race@g.us')
      .execute();
    expect(households).toHaveLength(1);
  });
});

describe('people and identities', () => {
  it('creates a person with all their identities', async () => {
    const person = await ensurePerson(t.db, {
      channel: 'whatsapp',
      displayName: 'Anna',
      identities: [
        { externalId: '48600000001@s.whatsapp.net', idType: 'pn' },
        { externalId: '11111@lid', idType: 'lid' },
      ],
    });
    const ids = await t.db
      .selectFrom('identities')
      .select(['external_id', 'id_type'])
      .where('person_id', '=', person.id)
      .orderBy('external_id')
      .execute();
    expect(ids).toEqual([
      { external_id: '11111@lid', id_type: 'lid' },
      { external_id: '48600000001@s.whatsapp.net', id_type: 'pn' },
    ]);
  });

  it('finds the same person by phone JID or LID, adding ids it sees for the first time', async () => {
    const byPhone = await ensurePerson(t.db, {
      channel: 'whatsapp',
      displayName: 'Tom',
      identities: [{ externalId: '48600000002@s.whatsapp.net', idType: 'pn' }],
    });
    const byBoth = await ensurePerson(t.db, {
      channel: 'whatsapp',
      displayName: 'Tom',
      identities: [
        { externalId: '22222@lid', idType: 'lid' },
        { externalId: '48600000002@s.whatsapp.net', idType: 'pn' },
      ],
    });
    const byLid = await ensurePerson(t.db, {
      channel: 'whatsapp',
      displayName: 'Tom',
      identities: [{ externalId: '22222@lid', idType: 'lid' }],
    });
    expect(byBoth.id).toBe(byPhone.id);
    expect(byLid.id).toBe(byPhone.id);
  });

  it('keeps the latest display name', async () => {
    const identities = [{ externalId: '33333@lid', idType: 'lid' as const }];
    await ensurePerson(t.db, { channel: 'whatsapp', displayName: 'Kasia', identities });
    const renamed = await ensurePerson(t.db, {
      channel: 'whatsapp',
      displayName: 'Kasia K.',
      identities,
    });
    expect(renamed.display_name).toBe('Kasia K.');
  });

  it('makes a sender a member once, however often they write', async () => {
    const { household } = await ensureChat(t.db, {
      channel: 'whatsapp',
      externalId: 'members@g.us',
      kind: 'group',
    });
    const sender = {
      channel: 'whatsapp',
      displayName: 'Ola',
      identities: [{ externalId: '44444@lid', idType: 'lid' as const }],
    };
    await ensureMember(t.db, household.id, sender);
    await ensureMember(t.db, household.id, sender);
    const members = await listMembers(t.db, household.id);
    expect(members.map((m) => m.display_name)).toEqual(['Ola']);
  });
});
