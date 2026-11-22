import { describe, expect, it } from 'vitest';

import { play, type Scenario } from '../../evals/harness.ts';
import { SCENARIOS } from '../../evals/scenarios/index.ts';
import { scriptedModel, type ScriptStep } from '../support/scripted-model.ts';
import { useTestDb } from './db.ts';

// The eval harness and checks, with scripted models standing in for real ones: a right
// script passes and a wrong one fails, so a failing eval means the model, not the harness.

const ctx = useTestDb();

function scenario(name: string): Scenario {
  const found = SCENARIOS.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no scenario ${name}`);
  return found;
}

async function playScript(name: string, steps: ScriptStep[]) {
  return play(scenario(name), scriptedModel(steps), ctx.db);
}

describe('eval scenarios', () => {
  it('digest-reply passes one done and one skipped', async () => {
    const outcome = await playScript('digest-reply', [
      {
        calls: [
          { tool: 'log_care', input: { plants: ['p1'], task_type: 'water', action: 'done' } },
          {
            tool: 'log_care',
            input: { plants: ['p2'], task_type: 'water', action: 'skipped', recheck_in_days: 2 },
          },
        ],
      },
      { text: "Logged the pothos ✓ I'll check the monstera again in 2 days." },
    ]);
    expect(outcome.failures).toEqual([]);
  });

  it('digest-reply fails when both are logged as done', async () => {
    const outcome = await playScript('digest-reply', [
      {
        calls: [{ tool: 'log_care', input: { plants: 'all', task_type: 'water', action: 'done' } }],
      },
      { text: 'Logged both.' },
    ]);
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.join()).toContain('monstera');
  });

  it('add-plants passes across a question and an answer', async () => {
    const outcome = await playScript('add-plants', [
      { text: 'When did you last water them?' },
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
          {
            tool: 'add_plant',
            input: {
              name: 'Monstera',
              room: 'bedroom',
              water_interval_days: 9,
              last_watered: '2026-11-08',
            },
          },
        ],
      },
      { text: 'Saved: Pothos, Monstera.' },
    ]);
    expect(outcome.failures).toEqual([]);
  });

  it('ignore-rules fails when a plant is archived', async () => {
    const outcome = await playScript('ignore-rules', [
      { calls: [{ tool: 'archive_plant', input: { plant: 'p1' } }] },
      { text: 'Done.' },
    ]);
    expect(outcome.passed).toBe(false);
  });

  it('off-topic passes a short decline', async () => {
    const outcome = await playScript('off-topic', [
      { text: 'I only help with plants, sorry! Anything your pothos needs?' },
    ]);
    expect(outcome.failures).toEqual([]);
  });
});
