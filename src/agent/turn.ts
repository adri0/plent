import type { ChatAdapter, InboundMessage } from '../channels/types.ts';
import type { Db } from '../db/client.ts';
import { ensureChat, ensureMember } from '../domain/households.ts';
import {
  findByExternalId,
  markSent,
  setStatus,
  storeOutbound,
  storeTrigger,
  type Message,
} from '../domain/messages.ts';
import type { Agent, AgentResult } from './agent.ts';

// One trigger, start to finish, in line: store it, run the agent, store and send the reply.
// The REPL and the evals use this. The real pipeline (queue, recovery, rate limit, router)
// comes in Phase 5 and replaces it there.

export interface TurnDeps {
  db: Db;
  agent: Agent;
  adapter: ChatAdapter;
}

export interface TurnResult {
  trigger: Message;
  reply: Message;
  result: AgentResult;
}

// Undefined when the message was seen before.
export async function runTurn(
  deps: TurnDeps,
  inbound: InboundMessage,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<TurnResult | undefined> {
  const { db, agent, adapter } = deps;
  const { household, chatId } = await ensureChat(db, inbound.chat);
  if (household.status !== 'active') {
    throw new Error(
      `household ${household.id} is ${household.status}: only active ones reach the agent`,
    );
  }
  const sender = await ensureMember(db, household.id, inbound.sender);
  const quoted =
    inbound.quotedExternalId === undefined
      ? undefined
      : await findByExternalId(db, chatId, inbound.quotedExternalId);
  const at = new Date(now.epochMilliseconds);

  const trigger = await storeTrigger(db, {
    chatId,
    externalId: inbound.externalId,
    senderPersonId: sender.id,
    body: inbound.text,
    quotedMessageId: quoted?.id,
    createdAt: at,
  });
  if (trigger === undefined) return undefined;
  await setStatus(db, trigger.id, 'processing');

  const result = await agent.handle({ household, sender, message: trigger, now });

  const reply = await storeOutbound(db, {
    chatId,
    kind: 'reply',
    body: result.reply,
    replyToId: trigger.id,
    createdAt: new Date(at.getTime() + 1),
  });
  const { externalId } = await adapter.send({
    chat: inbound.chat,
    text: result.reply,
    quoteExternalId: inbound.chat.kind === 'group' ? inbound.externalId : undefined,
  });
  await markSent(db, reply.id, externalId);
  await setStatus(db, trigger.id, result.status === 'ok' ? 'done' : 'failed');
  return { trigger, reply: { ...reply, external_id: externalId, status: 'sent' }, result };
}
