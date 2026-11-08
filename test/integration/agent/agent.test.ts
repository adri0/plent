import { describe, expect, it } from 'vitest';

import { createAgent, FALLBACK_REPLY, MAX_STEPS } from '../../../src/agent/agent.ts';
import { RefMap } from '../../../src/agent/refs.ts';
import { runRecorded, type ToolEffect } from '../../../src/agent/tools/run.ts';
import type { Household } from '../../../src/db/schema.ts';
import { DomainError } from '../../../src/domain/errors.ts';
import { ensureMember, type Person } from '../../../src/domain/households.ts';
import { storeTrigger, type Message } from '../../../src/domain/messages.ts';
import { addPlant } from '../../../src/domain/plants.ts';
import { createLogger } from '../../../src/ops/logger.ts';
import { scriptedModel, type ScriptStep } from '../../support/scripted-model.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from '../domain/fixtures.ts';

const ctx = useTestDb();
const logger = createLogger('silent');
// 18:40 in Warsaw on TODAY.
const NOW = Temporal.Instant.from(`${TODAY}T17:40:00Z`);

async function setup(text: string): Promise<{
  household: Household;
  sender: Person;
  message: Message;
}> {
  const household = await newHousehold(ctx.db);
  await ctx.db
    .updateTable('households')
    .set({ timezone: 'Europe/Warsaw' })
    .where('id', '=', household.id)
    .execute();
  const sender = await ensureMember(ctx.db, household.id, {
    channel: 'test',
    identities: [{ externalId: `anna-${household.id}`, idType: 'pn' }],
    displayName: 'Anna',
  });
  const chat = await ctx.db
    .selectFrom('chats')
    .select('id')
    .where('household_id', '=', household.id)
    .executeTakeFirstOrThrow();
  const message = await storeTrigger(ctx.db, {
    chatId: chat.id,
    externalId: `m-${household.id}`,
    senderPersonId: sender.id,
    body: text,
    createdAt: new Date(NOW.epochMilliseconds),
  });
  if (message === undefined) throw new Error('trigger not stored');
  return { household: { ...household, timezone: 'Europe/Warsaw' }, sender, message };
}

function run(steps: ScriptStep[], input: Awaited<ReturnType<typeof setup>>) {
  const model = scriptedModel(steps);
  const agent = createAgent({ db: ctx.db, model, logger, maxRetries: 0 });
  return { model, result: agent.handle({ ...input, now: NOW }) };
}

describe('agent', () => {
  it('runs tools, then replies in WhatsApp formatting', async () => {
    const input = await setup('we have a pothos in the living room, watered sunday');
    const { result } = run(
      [
        {
          calls: [
            {
              tool: 'add_plant',
              input: {
                name: 'Pothos',
                room: 'living room',
                water_interval_days: 7,
                last_watered: '2026-11-08',
              },
            },
          ],
        },
        { text: 'Saved **Pothos** (living room): water every 7 days, next Sun.' },
      ],
      input,
    );
    const out = await result;

    expect(out.status).toBe('ok');
    expect(out.reply).toBe('Saved *Pothos* (living room): water every 7 days, next Sun.');
    expect(out.effects).toMatchObject([
      { tool: 'add_plant', ok: true, replayed: false, result: { saved: 'Pothos', ref: 'p1' } },
    ]);
    const schedule = await ctx.db
      .selectFrom('care_schedules')
      .innerJoin('plants', 'plants.id', 'care_schedules.plant_id')
      .select(['care_schedules.next_due', 'plants.name'])
      .where('plants.household_id', '=', input.household.id)
      .executeTakeFirstOrThrow();
    expect(schedule).toEqual({ next_due: '2026-11-15', name: 'Pothos' });
    const usage = await ctx.db
      .selectFrom('llm_usage')
      .selectAll()
      .where('household_id', '=', input.household.id)
      .executeTakeFirstOrThrow();
    expect(usage).toMatchObject({ day: TODAY, requests: 2, input_tokens: 200, output_tokens: 40 });
  });

  it('replays recorded tool calls on a retry instead of running them again', async () => {
    const input = await setup('add a fern');
    const steps: ScriptStep[] = [
      { calls: [{ tool: 'add_plant', input: { name: 'Fern', water_interval_days: 4 } }] },
      { text: 'Saved the fern.' },
    ];
    await run(steps, input).result;
    const again = await run(steps, input).result;

    expect(again.effects).toMatchObject([{ tool: 'add_plant', ok: true, replayed: true }]);
    const plants = await ctx.db
      .selectFrom('plants')
      .select('name')
      .where('household_id', '=', input.household.id)
      .execute();
    expect(plants).toEqual([{ name: 'Fern' }]);
  });

  it('gives a broken rule back to the model as the tool result', async () => {
    const input = await setup('watered the cactus');
    const { model, result } = run(
      [
        {
          calls: [
            { tool: 'log_care', input: { plants: ['p9'], task_type: 'water', action: 'done' } },
          ],
        },
        { text: "I don't have a cactus yet. Want me to add it?" },
      ],
      input,
    );
    const out = await result;

    expect(out.effects).toMatchObject([{ tool: 'log_care', ok: false }]);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('unknown plant ref');
    const recorded = await ctx.db
      .selectFrom('tool_calls')
      .select('tool')
      .where('message_id', '=', input.message.id)
      .execute();
    expect(recorded).toEqual([]);
  });

  it('rolls back a tool effect when the tool then refuses', async () => {
    const input = await setup('add a palm');
    const effects: ToolEffect[] = [];
    const result = await runRecorded(
      {
        db: ctx.db,
        householdId: input.household.id,
        personId: input.sender.id,
        messageId: input.message.id,
        today: TODAY,
        refs: new RefMap(),
        effects,
        nextCallIndex: 0,
      },
      'add_plant',
      { name: 'Palm' },
      async (db) => {
        await addPlant(db, {
          householdId: input.household.id,
          name: 'Palm',
          waterIntervalDays: 7,
          today: TODAY,
        });
        throw new DomainError('invalid_input', 'refused after writing');
      },
    );

    expect(result).toEqual({ error: 'refused after writing' });
    expect(effects).toMatchObject([{ tool: 'add_plant', ok: false }]);
    const plants = await ctx.db
      .selectFrom('plants')
      .select('id')
      .where('household_id', '=', input.household.id)
      .execute();
    expect(plants).toEqual([]);
  });

  it('makes the last step answer in words', async () => {
    const input = await setup('loop forever');
    const looping: ScriptStep = {
      calls: [{ tool: 'get_history', input: {} }],
    };
    const { model, result } = run(
      [...Array.from({ length: MAX_STEPS - 1 }, () => looping), { text: 'Here you go.' }],
      input,
    );
    const out = await result;

    expect(out.steps).toBe(MAX_STEPS);
    expect(out.reply).toBe('Here you go.');
    expect(model.doGenerateCalls.at(-1)?.toolChoice).toEqual({ type: 'none' });
  });

  it('falls back to a fixed reply when the model fails', async () => {
    const input = await setup('hello');
    const { result } = run([{ error: new Error('model unavailable') }], input);
    const out = await result;
    expect(out).toMatchObject({ status: 'failed', reply: FALLBACK_REPLY, effects: [] });
  });
});
