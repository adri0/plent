import { addDays } from '../../src/domain/dates.ts';
import { onlyWrites, writes, type Scenario } from '../harness.ts';
import { activeNotes, activePlants, newEvents, questionCount, schedulesOf } from './queries.ts';

// The design's flows 2 to 6, as the agent sees them. Flow 1 (activation) and the photo reply
// in flow 7 are handled before the agent, by the router. Today is Thu 2026-11-12; Sunday was
// 2026-11-08.

const addPlants: Scenario = {
  name: 'add-plants',
  flow: '2. Adding plants',
  turns: [
    {
      from: 'Tom',
      text: '@Ent we have a pothos in the living room and a big monstera in the bedroom',
    },
    { from: 'Tom', text: 'sunday, both', replyTo: 'last-bot' },
  ],
  async check(run) {
    const failures: string[] = [];
    const plants = await activePlants(run);
    if (plants.length !== 2)
      failures.push(`expected 2 plants, got ${plants.map((p) => p.name).join(', ') || 'none'}`);
    for (const [pattern, room] of [
      [/pothos/i, /living/i],
      [/monstera/i, /bed/i],
    ] as const) {
      const plant = plants.find((p) => pattern.test(p.name));
      if (plant === undefined) {
        failures.push(`no plant matching ${String(pattern)}`);
        continue;
      }
      if (plant.room === null || !room.test(plant.room))
        failures.push(`${plant.name}: room ${String(plant.room)}`);
      const water = (await schedulesOf(run, plant.id)).find((s) => s.task_type === 'water');
      if (water === undefined) {
        failures.push(`${plant.name}: no water schedule`);
      } else {
        if (water.interval_days < 3 || water.interval_days > 21) {
          failures.push(`${plant.name}: water every ${String(water.interval_days)}d`);
        }
        if (water.next_due !== addDays('2026-11-08', water.interval_days)) {
          failures.push(`${plant.name}: next water ${water.next_due}, not Sunday + interval`);
        }
      }
    }
    const watered = (await newEvents(run)).filter((e) => e.task === 'water' && e.action === 'done');
    if (watered.length !== 2 || watered.some((e) => e.date !== '2026-11-08')) {
      failures.push(`expected both watered on 2026-11-08, got ${JSON.stringify(watered)}`);
    }
    const first = run.replies[0] ?? '';
    if (questionCount(first) > 1) failures.push(`more than one question: ${first}`);
    failures.push(...onlyWrites(run, ['add_plant', 'log_care', 'update_schedule']));
    return failures;
  },
};

const digestReply: Scenario = {
  name: 'digest-reply',
  flow: '3. Daily reminder reply',
  seed: async (s) => {
    await s.plant('Pothos', { room: 'living room', water: 7, lastWatered: '2026-11-05' });
    await s.plant('Monstera', { room: 'bedroom', water: 9, lastWatered: '2026-11-03' });
    await s.digest();
  },
  turns: [{ from: 'Anna', text: 'did the pothos, monstera soil still wet', replyTo: 'digest' }],
  async check(run) {
    const failures: string[] = [];
    const events = await newEvents(run);
    const pothos = events.filter((e) => e.plant === 'Pothos');
    const monstera = events.filter((e) => e.plant === 'Monstera');
    if (
      pothos.length !== 1 ||
      pothos[0]?.action !== 'done' ||
      pothos[0].task !== 'water' ||
      pothos[0].date !== run.today
    ) {
      failures.push(`pothos: expected one water done today, got ${JSON.stringify(pothos)}`);
    }
    const skip = monstera[0];
    if (monstera.length !== 1 || skip?.action !== 'skipped' || skip.task !== 'water') {
      failures.push(`monstera: expected one water skipped, got ${JSON.stringify(monstera)}`);
    } else if (skip.recheck === null || skip.recheck < 1 || skip.recheck > 7) {
      failures.push(`monstera: recheck in ${String(skip.recheck)} days`);
    }
    failures.push(...onlyWrites(run, ['log_care']));
    return failures;
  },
};

const logAll: Scenario = {
  name: 'log-all',
  flow: '4. Ad-hoc logging',
  seed: async (s) => {
    const monthly = [{ taskType: 'fertilize' as const, intervalDays: 30 }];
    await s.plant('Pothos', {
      room: 'living room',
      water: 7,
      lastWatered: '2026-11-08',
      extra: monthly,
    });
    await s.plant('Monstera', {
      room: 'bedroom',
      water: 9,
      lastWatered: '2026-11-08',
      extra: monthly,
    });
    await s.plant('Cactus', { room: 'kitchen', water: 21, lastWatered: '2026-11-01' });
  },
  turns: [{ from: 'Anna', text: '@Ent fertilized everything today' }],
  async check(run) {
    const failures: string[] = [];
    const events = await newEvents(run);
    for (const name of ['Pothos', 'Monstera']) {
      const fed = events.filter(
        (e) =>
          e.plant === name && e.task === 'fertilize' && e.action === 'done' && e.date === run.today,
      );
      if (fed.length !== 1)
        failures.push(`${name}: expected one fertilize done today, got ${String(fed.length)}`);
    }
    const others = events.filter((e) => e.task !== 'fertilize');
    if (others.length > 0) failures.push(`other care logged: ${JSON.stringify(others)}`);
    failures.push(...onlyWrites(run, ['log_care']));
    return failures;
  },
};

const status: Scenario = {
  name: 'status',
  flow: '5. Status',
  seed: async (s) => {
    await s.plant('Pothos', { room: 'living room', water: 7, lastWatered: '2026-11-07' }); // Sat 14th
    await s.plant('Monstera', { room: 'bedroom', water: 9, lastWatered: '2026-11-01' }); // overdue since 10th
    await s.plant('Fern', { room: 'bathroom', water: 20, lastWatered: '2026-11-10' }); // 30th
  },
  turns: [{ from: 'Tom', text: "@Ent what's due this week?" }],
  check(run) {
    const failures: string[] = [];
    const reply = run.replies[0] ?? '';
    for (const name of ['pothos', 'monstera']) {
      if (!reply.toLowerCase().includes(name))
        failures.push(`reply doesn't mention ${name}: ${reply}`);
    }
    failures.push(...onlyWrites(run, []));
    return Promise.resolve(failures);
  },
};

const archive: Scenario = {
  name: 'archive',
  flow: '6. Removal',
  seed: async (s) => {
    await s.plant('Pothos', { room: 'living room', water: 7 });
    await s.plant('Monstera', { room: 'bedroom', water: 9 });
    await s.plant('Rosemary', { room: 'kitchen', water: 5 });
  },
  turns: [{ from: 'Anna', text: '@Ent the rosemary died' }],
  async check(run) {
    const failures: string[] = [];
    const names = (await activePlants(run)).map((p) => p.name).sort();
    if (names.join() !== 'Monstera,Pothos') failures.push(`active plants: ${names.join(', ')}`);
    if (writes(run).filter((e) => e.tool === 'archive_plant').length !== 1)
      failures.push('expected one archive_plant');
    failures.push(...onlyWrites(run, ['archive_plant']));
    return failures;
  },
};

const edit: Scenario = {
  name: 'edit',
  flow: '6. Editing',
  seed: async (s) => {
    await s.plant('Pothos', { room: 'living room', water: 7, lastWatered: '2026-11-08' });
    await s.plant('Monstera', { room: 'bedroom', water: 9, lastWatered: '2026-11-08' });
  },
  turns: [
    {
      from: 'Tom',
      text: '@Ent move the pothos to the kitchen and water the monstera every 12 days',
    },
  ],
  async check(run) {
    const failures: string[] = [];
    const plants = await activePlants(run);
    const pothos = plants.find((p) => p.name === 'Pothos');
    if (pothos?.room === undefined || pothos.room === null || !/kitchen/i.test(pothos.room)) {
      failures.push(`pothos room: ${String(pothos?.room)}`);
    }
    const monstera = plants.find((p) => p.name === 'Monstera');
    const water =
      monstera === undefined
        ? undefined
        : (await schedulesOf(run, monstera.id)).find((s) => s.task_type === 'water');
    if (water?.interval_days !== 12)
      failures.push(`monstera water every ${String(water?.interval_days)}d`);
    if (water !== undefined && water.next_due !== '2026-11-20')
      failures.push(`monstera next water ${water.next_due}`);
    failures.push(...onlyWrites(run, ['update_plant', 'update_schedule']));
    return failures;
  },
};

const note: Scenario = {
  name: 'note',
  flow: '6. Notes',
  seed: async (s) => {
    await s.plant('Pothos', { room: 'living room', water: 7 });
    await s.plant('Monstera', { room: 'bedroom', water: 9 });
  },
  turns: [{ from: 'Anna', text: '@Ent the monstera has a broken branch' }],
  async check(run) {
    const failures: string[] = [];
    const notes = await activeNotes(run);
    if (notes.length !== 1 || notes[0]?.plant !== 'Monstera' || !/branch/i.test(notes[0].body)) {
      failures.push(`expected one monstera note about the branch, got ${JSON.stringify(notes)}`);
    }
    failures.push(...onlyWrites(run, ['add_note']));
    return failures;
  },
};

export const FLOW_SCENARIOS: Scenario[] = [
  addPlants,
  digestReply,
  logAll,
  status,
  archive,
  edit,
  note,
];
