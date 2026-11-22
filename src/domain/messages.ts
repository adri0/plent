import type { Selectable } from 'kysely';

import type { Db } from '../db/client.ts';
import type { MessageKind, MessagesTable } from '../db/schema.ts';

// Stored messages: inbound triggers and everything the bot sends. Ordinary chatter is never
// stored. The full queue (statuses, recovery) comes with the pipeline; these are the reads
// and writes the agent and its callers need.

export type Message = Selectable<MessagesTable>;

// A digest's `payload`: the items it listed, so replies resolve against exactly what was sent.
export interface DigestItem {
  plantId: string;
  scheduleId: string;
  taskType: string;
}

export interface DigestPayload {
  items: DigestItem[];
}

export interface NewTrigger {
  chatId: string;
  externalId: string;
  senderPersonId: string;
  body: string;
  quotedMessageId?: string | undefined;
  createdAt?: Date | undefined; // now by default; evals and tests set their own clock
}

// Stores an inbound trigger as `received`. A message seen before (same chat and external id)
// returns undefined, so redelivery never answers twice.
export async function storeTrigger(db: Db, input: NewTrigger): Promise<Message | undefined> {
  return db
    .insertInto('messages')
    .values({
      chat_id: input.chatId,
      external_id: input.externalId,
      direction: 'in',
      kind: 'trigger',
      sender_person_id: input.senderPersonId,
      body: input.body,
      quoted_message_id: input.quotedMessageId ?? null,
      status: 'received',
      ...(input.createdAt === undefined ? {} : { created_at: input.createdAt }),
    })
    .onConflict((oc) => oc.columns(['chat_id', 'external_id']).doNothing())
    .returningAll()
    .executeTakeFirst();
}

export interface NewOutbound {
  chatId: string;
  kind: Exclude<MessageKind, 'trigger'>;
  body: string;
  payload?: DigestPayload | undefined;
  replyToId?: string | undefined;
  createdAt?: Date | undefined;
}

// An outgoing message, `pending` until the channel confirms it with its own id.
export async function storeOutbound(db: Db, input: NewOutbound): Promise<Message> {
  return db
    .insertInto('messages')
    .values({
      chat_id: input.chatId,
      direction: 'out',
      kind: input.kind,
      body: input.body,
      payload: input.payload === undefined ? null : JSON.stringify(input.payload),
      reply_to_id: input.replyToId ?? null,
      status: 'pending',
      ...(input.createdAt === undefined ? {} : { created_at: input.createdAt }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function markSent(db: Db, messageId: string, externalId: string): Promise<void> {
  await db
    .updateTable('messages')
    .set({ status: 'sent', external_id: externalId })
    .where('id', '=', messageId)
    .execute();
}

export async function setStatus(
  db: Db,
  messageId: string,
  status: Message['status'],
): Promise<void> {
  await db.updateTable('messages').set({ status }).where('id', '=', messageId).execute();
}

export async function findByExternalId(
  db: Db,
  chatId: string,
  externalId: string,
): Promise<Message | undefined> {
  return db
    .selectFrom('messages')
    .selectAll()
    .where('chat_id', '=', chatId)
    .where('external_id', '=', externalId)
    .executeTakeFirst();
}

export async function getMessage(db: Db, messageId: string): Promise<Message | undefined> {
  return db.selectFrom('messages').selectAll().where('id', '=', messageId).executeTakeFirst();
}

export interface HistoryLine {
  id: string;
  direction: 'in' | 'out';
  senderName: string | null; // null for the bot
  body: string;
  createdAt: Date;
}

// The conversation before a message: the last `limit` stored messages with a body from the
// past `hours`, whichever is fewer, oldest first. Failed and stale triggers are left out.
export async function recentHistory(
  db: Db,
  chatId: string,
  before: Message,
  options: { limit?: number; hours?: number } = {},
): Promise<HistoryLine[]> {
  const limit = options.limit ?? 20;
  const since = new Date(before.created_at.getTime() - (options.hours ?? 72) * 60 * 60 * 1000);
  const rows = await db
    .selectFrom('messages')
    .leftJoin('people', 'people.id', 'messages.sender_person_id')
    .select([
      'messages.id as id',
      'messages.direction as direction',
      'people.display_name as senderName',
      'messages.body as body',
      'messages.created_at as createdAt',
    ])
    .where('messages.chat_id', '=', chatId)
    .where('messages.id', '!=', before.id)
    .where('messages.created_at', '<=', before.created_at)
    .where('messages.created_at', '>=', since)
    .where('messages.body', 'is not', null)
    .where('messages.status', 'not in', ['failed', 'skipped_stale'])
    .orderBy('messages.created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.reverse().map((r) => ({
    ...r,
    body: r.body ?? '',
    senderName: r.direction === 'out' ? null : r.senderName,
  }));
}

export function isDigestPayload(payload: unknown): payload is DigestPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    Array.isArray((payload as { items?: unknown }).items)
  );
}
