// Runs the eval suite: each scenario several times per model, on a scratch database each run.
// A scenario passes when enough of its runs pass (2 of 3 by default).
//
//   npm run eval -- [--runs 3] [--pass 2] [--only add-plants,status] [--concurrency 3]
//                   [--model anthropic:claude-haiku-5-5 --model google:gemini-3.5-flash]
//
// Models default to MODEL_PROVIDER / MODEL_ID; each --model is provider:id, with keys and
// locations from the same environment variables. Results go to evals/results/ as JSON.
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { createModel } from '../src/agent/model.ts';
import { loadConfig, type ModelConfig } from '../src/config.ts';
import { runScenario, type RunOutcome } from './harness.ts';
import { SCENARIOS } from './scenarios/index.ts';

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    pass: { type: 'string', default: '2' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    model: { type: 'string', multiple: true },
  },
});
const runs = Number(args.runs);
const needed = Number(args.pass);
const concurrency = Number(args.concurrency);

const only = args.only?.split(',').map((s) => s.trim());
const scenarios = only === undefined ? SCENARIOS : SCENARIOS.filter((s) => only.includes(s.name));
if (scenarios.length === 0) {
  console.error(`No scenarios match. Known: ${SCENARIOS.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

function modelConfigs(): ModelConfig[] {
  const specs = args.model ?? [undefined];
  return specs.map((spec) => {
    const env = { ...process.env };
    if (spec !== undefined) {
      const [provider, ...id] = spec.split(':');
      env.MODEL_PROVIDER = provider;
      env.MODEL_ID = id.join(':');
    }
    const { model } = loadConfig(env);
    if (model === undefined) {
      console.error('No model configured: set MODEL_PROVIDER and MODEL_ID, or pass --model.');
      process.exit(1);
    }
    return model;
  });
}

// Runs tasks with at most `limit` in flight, keeping their order in the results.
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      if (task !== undefined) results[i] = await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const config = loadConfig();
const report: Record<string, unknown>[] = [];
let allPassed = true;

for (const modelConfig of modelConfigs()) {
  const label = `${modelConfig.provider}:${modelConfig.id}`;
  const model = createModel(modelConfig, config.gcpProject);
  console.log(`\n${label}: ${String(scenarios.length)} scenarios × ${String(runs)} runs`);

  const tasks = scenarios.flatMap((scenario) =>
    Array.from({ length: runs }, () => async (): Promise<RunOutcome> => {
      try {
        return await runScenario(scenario, model, config.databaseUrl);
      } catch (error) {
        return {
          scenario: scenario.name,
          passed: false,
          failures: [`crashed: ${String(error)}`],
          replies: [],
          effects: [],
          inputTokens: 0,
          outputTokens: 0,
          ms: 0,
        };
      }
    }),
  );
  const outcomes = await pool(tasks, concurrency);

  let scenariosPassed = 0;
  for (const scenario of scenarios) {
    const mine = outcomes.filter((o) => o.scenario === scenario.name);
    const passes = mine.filter((o) => o.passed).length;
    const ok = passes >= needed;
    if (ok) scenariosPassed += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${scenario.name.padEnd(14)} ${String(passes)}/${String(mine.length)}  ${scenario.flow}`,
    );
    for (const [i, o] of mine.entries()) {
      if (o.passed) continue;
      console.log(`      run ${String(i + 1)}: ${o.failures.join('; ')}`);
      for (const reply of o.replies) console.log(`        Ent: ${reply.replaceAll('\n', ' ⏎ ')}`);
    }
  }
  const tokensIn = outcomes.reduce((n, o) => n + o.inputTokens, 0);
  const tokensOut = outcomes.reduce((n, o) => n + o.outputTokens, 0);
  const turns = scenarios.reduce((n, s) => n + s.turns.length, 0) * runs;
  const ms = outcomes.reduce((n, o) => n + o.ms, 0);
  console.log(
    `  ${String(scenariosPassed)}/${String(scenarios.length)} scenarios pass · ` +
      `${String(Math.round(tokensIn / turns))} in, ${String(Math.round(tokensOut / turns))} out tokens per turn · ` +
      `${String(Math.round(ms / turns))} ms per turn`,
  );
  if (scenariosPassed < scenarios.length) allPassed = false;
  report.push({
    model: label,
    runs,
    needed,
    scenariosPassed,
    scenarios: scenarios.length,
    tokensIn,
    tokensOut,
    ms,
    outcomes,
  });
}

await mkdir(new URL('./results/', import.meta.url), { recursive: true });
const file = new URL(
  `./results/${new Date().toISOString().replaceAll(':', '-')}.json`,
  import.meta.url,
);
await writeFile(file, JSON.stringify(report, null, 2));
console.log(`\nReport: ${file.pathname}`);
process.exit(allPassed ? 0 : 1);
