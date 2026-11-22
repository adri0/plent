// Chat with the agent in the terminal, through the fake chat adapter, against the database at
// DATABASE_URL and the model in MODEL_*. The chat is a group household, activated on first use.
//
//   npm run repl -- [--chat dev] [--as Anna] [--tz Europe/Warsaw]
//
// Type a message to send it as the current sender. Commands: /as <name> switches sender,
// /reply quotes Ent's last message with your next one, /digest sends today's reminder (a
// plain stand-in for Phase 6's), /help, /quit.
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { createAgent } from '../src/agent/agent.ts';
import { createModel } from '../src/agent/model.ts';
import { runTurn } from '../src/agent/turn.ts';
import { FakeAdapter } from '../src/channels/fake/adapter.ts';
import type { ChatRef, SenderRef } from '../src/channels/types.ts';
import { createDb } from '../src/db/client.ts';
import { loadConfig } from '../src/config.ts';
import { localDate } from '../src/domain/dates.ts';
import { ensureChat } from '../src/domain/households.ts';
import { markSent, storeOutbound } from '../src/domain/messages.ts';
import { listDue } from '../src/domain/plants.ts';
import { parseTimeZone } from '../src/domain/settings.ts';
import { BOT_NAME } from '../src/index.ts';
import { createLogger } from '../src/ops/logger.ts';

const { values: args } = parseArgs({
  options: {
    chat: { type: 'string', default: 'dev' },
    as: { type: 'string', default: 'You' },
    tz: { type: 'string', default: 'Europe/Warsaw' },
  },
});

const config = loadConfig();
if (config.model === undefined) {
  console.error('No model configured: set MODEL_PROVIDER and MODEL_ID (see .env.example).');
  process.exit(1);
}
const db = createDb(config.databaseUrl);
// Agent logs go to stderr at warn unless LOG_LEVEL asks for more, so they don't drown the chat.
const logger = createLogger(process.env.LOG_LEVEL ?? 'warn', process.stderr);
const agent = createAgent({ db, model: createModel(config.model, config.gcpProject), logger });
const adapter = new FakeAdapter('repl');
await adapter.start({ onMessage: () => Promise.resolve(), onChatEvent: () => Promise.resolve() });

const chat: ChatRef = { channel: 'repl', externalId: args.chat, kind: 'group' };
const { household, chatId } = await ensureChat(db, chat);
if (household.status !== 'active') {
  await db
    .updateTable('households')
    .set({ status: 'active', activated_at: new Date(), timezone: parseTimeZone(args.tz) })
    .where('id', '=', household.id)
    .execute();
}

let senderName = args.as;
let quoteNext = false;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function sender(name: string): SenderRef {
  return {
    channel: 'repl',
    identities: [{ externalId: `repl:${name.toLowerCase()}`, idType: 'pn' }],
    displayName: name,
  };
}

async function sendDigest(): Promise<void> {
  const fresh = await db
    .selectFrom('households')
    .selectAll()
    .where('id', '=', household.id)
    .executeTakeFirstOrThrow();
  const due = await listDue(db, household.id, localDate(fresh.timezone));
  if (due.length === 0) {
    console.log(dim('(nothing due today: no reminder)'));
    return;
  }
  const items = due.map((d) => {
    const where = [d.room, d.daysOverdue > 0 ? `${String(d.daysOverdue)} days overdue` : null]
      .filter((x) => x !== null)
      .join(', ');
    return `${d.taskType} ${d.plantName}${where === '' ? '' : ` (${where})`}`;
  });
  const body = `Today: ${items.join(', ')}. Reply when done.`;
  const message = await storeOutbound(db, {
    chatId,
    kind: 'digest',
    body,
    payload: {
      items: due.map((d) => ({
        plantId: d.plantId,
        scheduleId: d.scheduleId,
        taskType: d.taskType,
      })),
    },
  });
  const { externalId } = await adapter.send({ chat, text: body });
  await markSent(db, message.id, externalId);
  console.log(`${BOT_NAME}: ${body}`);
}

console.log(
  dim(`${config.model.provider} ${config.model.id} · chat "${args.chat}" · /help for commands`),
);
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on('close', () => {
  void db.destroy().then(() => process.exit(0));
});

for (;;) {
  const line = (await rl.question(`${senderName}${quoteNext ? ' ↩' : ''}> `)).trim();
  if (line === '') continue;
  if (line === '/quit' || line === '/exit') break;
  if (line === '/help') {
    console.log(dim('/as <name> · /reply · /digest · /quit'));
    continue;
  }
  if (line.startsWith('/as ')) {
    senderName = line.slice(4).trim() || senderName;
    continue;
  }
  if (line === '/reply') {
    quoteNext = true;
    continue;
  }
  if (line === '/digest') {
    await sendDigest();
    continue;
  }

  const quoted = quoteNext ? adapter.lastSent()?.externalId : undefined;
  quoteNext = false;
  const turn = await runTurn(
    { db, agent, adapter },
    {
      chat,
      externalId: adapter.newId('in'),
      sender: sender(senderName),
      text: line,
      mentionsBot: true,
      quotedExternalId: quoted,
      hasMedia: false,
      sentAt: new Date(),
    },
  );
  if (turn === undefined) continue;
  for (const e of turn.result.effects) {
    const mark = e.ok ? (e.replayed ? '↻' : '✓') : '✗';
    console.log(dim(`  ${mark} ${e.tool} ${JSON.stringify(e.args)} → ${JSON.stringify(e.result)}`));
  }
  console.log(
    dim(
      `  ${String(turn.result.steps)} steps · ${String(turn.result.usage.inputTokens)} in, ${String(turn.result.usage.outputTokens)} out`,
    ),
  );
  console.log(`${BOT_NAME}: ${turn.result.reply}`);
}
rl.close();
