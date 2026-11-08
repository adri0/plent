import type { Selectable } from 'kysely';

import type { Db } from '../db/client.ts';
import type { ChatKind, Household, IdType, PeopleTable } from '../db/schema.ts';

// Households, chats, people and identities, created lazily: a household and chat when the
// bot first sees a chat, a person, identity and membership on that person's first trigger.

export type Person = Selectable<PeopleTable>;

export interface ChatRef {
  channel: string;
  externalId: string; // group or DM id on the channel
  kind: ChatKind;
}

export interface Identity {
  externalId: string; // phone JID or LID
  idType: IdType;
}

export interface SenderRef {
  channel: string;
  identities: Identity[]; // every id the channel gave for this sender, e.g. both JID and LID
  displayName: string;
}

// The chat's household, created `pending` with its chat if this is the first time.
export async function ensureChat(
  db: Db,
  chat: ChatRef,
): Promise<{ household: Household; chatId: string; created: boolean }> {
  const existing = await findChat(db, chat);
  if (existing !== undefined) return { ...existing, created: false };

  const created = await db.transaction().execute(async (trx) => {
    const household = await trx
      .insertInto('households')
      .defaultValues()
      .returningAll()
      .executeTakeFirstOrThrow();
    const inserted = await trx
      .insertInto('chats')
      .values({
        household_id: household.id,
        channel: chat.channel,
        external_id: chat.externalId,
        kind: chat.kind,
      })
      .onConflict((oc) => oc.columns(['channel', 'external_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted === undefined) {
      // Created concurrently: undo our household and use the other one.
      await trx.deleteFrom('households').where('id', '=', household.id).execute();
      return undefined;
    }
    return { household, chatId: inserted.id };
  });
  if (created !== undefined) return { ...created, created: true };

  const raced = await findChat(db, chat);
  if (raced === undefined) throw new Error(`chat ${chat.channel}:${chat.externalId} vanished`);
  return { ...raced, created: false };
}

async function findChat(
  db: Db,
  chat: ChatRef,
): Promise<{ household: Household; chatId: string } | undefined> {
  const row = await db
    .selectFrom('chats')
    .innerJoin('households', 'households.id', 'chats.household_id')
    .selectAll('households')
    .select('chats.id as chat_id')
    .where('chats.channel', '=', chat.channel)
    .where('chats.external_id', '=', chat.externalId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const { chat_id, ...household } = row;
  return { household, chatId: chat_id };
}

// The person behind a sender. Any known identity finds them; identities seen for the first
// time are added to that person, so a phone JID and a LID map to the same person.
export async function ensurePerson(db: Db, sender: SenderRef): Promise<Person> {
  if (sender.identities.length === 0) throw new Error('a sender needs at least one identity');
  return db.transaction().execute(async (trx) => {
    const known = await trx
      .selectFrom('identities')
      .innerJoin('people', 'people.id', 'identities.person_id')
      .selectAll('people')
      .where('identities.channel', '=', sender.channel)
      .where(
        'identities.external_id',
        'in',
        sender.identities.map((i) => i.externalId),
      )
      .orderBy('people.created_at')
      .executeTakeFirst();

    let person: Person;
    if (known === undefined) {
      person = await trx
        .insertInto('people')
        .values({ display_name: sender.displayName })
        .returningAll()
        .executeTakeFirstOrThrow();
    } else if (known.display_name !== sender.displayName && sender.displayName !== '') {
      person = await trx
        .updateTable('people')
        .set({ display_name: sender.displayName })
        .where('id', '=', known.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    } else {
      person = known;
    }

    await trx
      .insertInto('identities')
      .values(
        sender.identities.map((i) => ({
          channel: sender.channel,
          external_id: i.externalId,
          id_type: i.idType,
          person_id: person.id,
        })),
      )
      .onConflict((oc) => oc.columns(['channel', 'external_id']).doNothing())
      .execute();
    return person;
  });
}

export async function ensureMembership(
  db: Db,
  householdId: string,
  personId: string,
): Promise<void> {
  await db
    .insertInto('memberships')
    .values({ household_id: householdId, person_id: personId })
    .onConflict((oc) => oc.columns(['household_id', 'person_id']).doNothing())
    .execute();
}

// A trigger's sender as a member of the household: person, identities and membership.
export async function ensureMember(
  db: Db,
  householdId: string,
  sender: SenderRef,
): Promise<Person> {
  const person = await ensurePerson(db, sender);
  await ensureMembership(db, householdId, person.id);
  return person;
}

export async function getHousehold(db: Db, householdId: string): Promise<Household | undefined> {
  return db.selectFrom('households').selectAll().where('id', '=', householdId).executeTakeFirst();
}

export async function listMembers(db: Db, householdId: string): Promise<Person[]> {
  return db
    .selectFrom('memberships')
    .innerJoin('people', 'people.id', 'memberships.person_id')
    .selectAll('people')
    .where('memberships.household_id', '=', householdId)
    .orderBy('memberships.joined_at')
    .execute();
}
