import { randomUUID } from 'node:crypto';

import type { LanguageModel } from 'ai';
import { sql } from 'kysely';

import { createAgent } from '../src/agent/agent.ts';
import { WRITE_TOOLS, type ToolEffect } from '../src/agent/tools/index.ts';
import { runTurn, type TurnResult } from '../src/agent/turn.ts';
import { FakeAdapter } from '../src/channels/fake/adapter.ts';
import type { ChatRef } from '../src/channels/types.ts';
import { createDb, type Db } from '../src/db/client.ts';
import { migrateToLatest } from '../src/db/migrate.ts';
import type { TaskType } from '../src/db/schema.ts';
import { localDate, type IsoDate } from '../src/domain/dates.ts';
import { ensureChat } from '../src/domain/households.ts';
import { markSent, storeOutbound } from '../src/domain/messages.ts';
import { addNote } from '../src/domain/notes.ts';
import { addPlant, listDue } from '../src/domain/plants.ts';
import { createLogger } from '../src/ops/logger.ts';

// A scenario is a scripted conversation against a seeded household. Its checks look at the
// database and the tool calls, never at exact wording.

export interface Scenario {
  name: string;
  flow: string; // the design's flow or adversarial case it covers
  now?: string; // instant of the first turn; Thu 2026-11-12 18:40 in Warsaw by default
  timezone?: string;
  seed?: (seed: Seed) => Promise<void>;
  turns: Turn[];
  // Returns what went wrong; empty means the run passed.
  check: (run: ScenarioRun) => Promise<string[]>;
}

export interface Turn {
  from: string;
  text: string;
  replyTo?: 'last-bot' | 'digest';
}

export interface SeedPlant {
  room?: string;
  water: number; // interval in days
  lastWatered?: IsoDate;
  extra?: { taskType: TaskType; intervalDays: number }[];
}

export interface Seed {
  db: Db;
  householdId: string;
  today: IsoDate;
  plant(name: string, plant: SeedPlant): Promise<string>;
  note(body: string, plantId?: string): Promise<string>;
  // Sends today's reminder for whatever is due, as Phase 6 will.
  digest(): Promise<void>;
}

export interface ScenarioRun {
  db: Db;
  householdId: string;
  today: IsoDate;
  turns: TurnResult[];
  effects: ToolEffect[]; // every tool call across the turns
  replies: string[];
  plantId(name: string): Promise<string>;
}

export const DEFAULT_NOW = '2026-11-12T17:40:00Z';
const DEFAULT_TZ = 'Europe/Warsaw';

export interface RunOutcome {
  scenario: string;
  passed: boolean;
  failures: string[];
  replies: string[];
  effects: ToolEffect[];
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

// Runs a scenario once on its own scratch database, which is dropped afterwards.
export async function runScenario(
  scenario: Scenario,
  model: LanguageModel,
  databaseUrl: string,
): Promise<RunOutcome> {
  const name = `plent_eval_${randomUUID().replaceAll('-', '')}`;
  const admin = createDb(databaseUrl);
  await sql`create database ${sql.id(name)}`.execute(admin);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const db = createDb(url.toString());
  try {
    await migrateToLatest(db);
    return await play(scenario, model, db);
  } finally {
    await db.destroy();
    await sql`drop database if exists ${sql.id(name)}`.execute(admin);
    await admin.destroy();
  }
}

export async function play(scenario: Scenario, model: LanguageModel, db: Db): Promise<RunOutcome> {
  const start = Temporal.Instant.from(scenario.now ?? DEFAULT_NOW);
  const timezone = scenario.timezone ?? DEFAULT_TZ;
  const today = localDate(timezone, start);
  const adapter = new FakeAdapter('eval');
  await adapter.start({ onMessage: () => Promise.resolve(), onChatEvent: () => Promise.resolve() });
  const chat: ChatRef = { channel: 'eval', externalId: `group-${randomUUID()}`, kind: 'group' };
  const { household, chatId } = await ensureChat(db, chat);
  await db
    .updateTable('households')
    .set({ status: 'active', activated_at: new Date(start.epochMilliseconds), timezone })
    .where('id', '=', household.id)
    .execute();

  let digestId: string | undefined;
  if (scenario.seed !== undefined) {
    await scenario.seed({
      db,
      householdId: household.id,
      today,
      plant: async (plantName, p) =>
        (
          await addPlant(db, {
            householdId: household.id,
            name: plantName,
            room: p.room,
            waterIntervalDays: p.water,
            lastWatered: p.lastWatered,
            extraTasks: p.extra,
            today,
          })
        ).plant.id,
      note: async (body, plantId) =>
        (await addNote(db, { householdId: household.id, plantId, body })).id,
      digest: async () => {
        const due = await listDue(db, household.id, today);
        const items = due.map((d) => `${d.taskType} ${d.plantName}`);
        const message = await storeOutbound(db, {
          chatId,
          kind: 'digest',
          body: `Today: ${items.join(', ')}. Reply when done.`,
          payload: {
            items: due.map((d) => ({
              plantId: d.plantId,
              scheduleId: d.scheduleId,
              taskType: d.taskType,
            })),
          },
          // The morning's reminder, before the turns.
          createdAt: new Date(start.epochMilliseconds - 8 * 60 * 60 * 1000),
        });
        const { externalId } = await adapter.send({ chat, text: message.body ?? '' });
        await markSent(db, message.id, externalId);
        digestId = externalId;
      },
    });
  }

  const agent = createAgent({ db, model, logger: createLogger('silent') });
  const turns: TurnResult[] = [];
  const started = performance.now();
  for (const [i, turn] of scenario.turns.entries()) {
    const quoted =
      turn.replyTo === 'digest'
        ? digestId
        : turn.replyTo === 'last-bot'
          ? adapter.lastSent()?.externalId
          : undefined;
    const result = await runTurn(
      { db, agent, adapter },
      {
        chat,
        externalId: adapter.newId('in'),
        sender: {
          channel: 'eval',
          identities: [{ externalId: `eval:${turn.from.toLowerCase()}`, idType: 'pn' }],
          displayName: turn.from,
        },
        text: turn.text,
        mentionsBot: true,
        quotedExternalId: quoted,
        hasMedia: false,
        sentAt: new Date(),
      },
      start.add({ minutes: i * 2 }),
    );
    if (result !== undefined) turns.push(result);
  }
  const ms = performance.now() - started;

  const run: ScenarioRun = {
    db,
    householdId: household.id,
    today,
    turns,
    effects: turns.flatMap((t) => t.result.effects),
    replies: turns.map((t) => t.result.reply),
    plantId: async (plantName) =>
      (
        await db
          .selectFrom('plants')
          .select('id')
          .where('household_id', '=', household.id)
          .where('name', '=', plantName)
          .executeTakeFirstOrThrow()
      ).id,
  };
  const failures = turns.some((t) => t.result.status === 'failed')
    ? ['the model failed (fallback reply sent)']
    : await scenario.check(run);
  return {
    scenario: scenario.name,
    passed: failures.length === 0,
    failures,
    replies: run.replies,
    effects: run.effects,
    inputTokens: turns.reduce((n, t) => n + t.result.usage.inputTokens, 0),
    outputTokens: turns.reduce((n, t) => n + t.result.usage.outputTokens, 0),
    ms,
  };
}

// Successful calls to tools that change data.
export function writes(run: ScenarioRun): ToolEffect[] {
  return run.effects.filter((e) => e.ok && WRITE_TOOLS.has(e.tool));
}

// A failure for each successful write call outside `allowed`.
export function onlyWrites(run: ScenarioRun, allowed: string[]): string[] {
  return writes(run)
    .filter((e) => !allowed.includes(e.tool))
    .map((e) => `unexpected ${e.tool} ${JSON.stringify(e.args)}`);
}
