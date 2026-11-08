import { describe, expect, it } from 'vitest';

import { buildContext } from '../../../src/agent/context.ts';
import { logCare } from '../../../src/domain/care.ts';
import { ensureMember } from '../../../src/domain/households.ts';
import { markSent, storeOutbound, storeTrigger } from '../../../src/domain/messages.ts';
import { addNote } from '../../../src/domain/notes.ts';
import { addPlant, archivePlant } from '../../../src/domain/plants.ts';
import { useTestDb } from '../db.ts';
import { newHousehold, TODAY } from '../domain/fixtures.ts';

const ctx = useTestDb();
const NOW = Temporal.Instant.from(`${TODAY}T17:40:00Z`); // Thu 18:40 in Warsaw

describe('buildContext', () => {
  it('shows the household, the conversation and the message with what it quotes', async () => {
    const { db } = ctx;
    const base = await newHousehold(db);
    const household = await db
      .updateTable('households')
      .set({ timezone: 'Europe/Warsaw' })
      .where('id', '=', base.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    const chat = await db
      .selectFrom('chats')
      .select('id')
      .where('household_id', '=', household.id)
      .executeTakeFirstOrThrow();
    const anna = await ensureMember(db, household.id, {
      channel: 'test',
      identities: [{ externalId: `anna-${household.id}`, idType: 'pn' }],
      displayName: 'Anna',
    });
    const tom = await ensureMember(db, household.id, {
      channel: 'test',
      identities: [{ externalId: `tom-${household.id}`, idType: 'pn' }],
      displayName: 'Tom',
    });

    const { plant: rosemary } = await addPlant(db, {
      householdId: household.id,
      name: 'Rosemary',
      waterIntervalDays: 5,
      today: '2026-11-01',
    });
    await archivePlant(db, household.id, rosemary.id, 'died');
    const { plant: pothos, schedules } = await addPlant(db, {
      householdId: household.id,
      name: 'Pothos',
      room: 'living room',
      waterIntervalDays: 7,
      lastWatered: '2026-11-08',
      today: TODAY,
    });
    const { plant: monstera } = await addPlant(db, {
      householdId: household.id,
      name: 'Monstera',
      room: 'bedroom',
      waterIntervalDays: 9,
      today: '2026-11-01',
    });
    await logCare(db, {
      householdId: household.id,
      plants: [monstera.id],
      taskType: 'water',
      action: 'done',
      occurredOn: '2026-11-01',
      today: '2026-11-01',
    });
    const cat = await addNote(db, { householdId: household.id, body: 'cat chews leaves' });
    const branch = await addNote(db, {
      householdId: household.id,
      plantId: monstera.id,
      body: 'broken branch',
    });
    for (const [id, at] of [
      [cat.id, '2026-09-01T10:00:00Z'],
      [branch.id, '2026-10-20T10:00:00Z'],
    ] as const) {
      await db.updateTable('plant_notes').set({ created_at: at }).where('id', '=', id).execute();
    }

    const digest = await storeOutbound(db, {
      chatId: chat.id,
      kind: 'digest',
      body: 'Today: water Monstera (bedroom, 2 days overdue). Reply when done.',
      payload: {
        items: [
          { plantId: monstera.id, scheduleId: schedules[0]?.id ?? '', taskType: 'water' },
          { plantId: rosemary.id, scheduleId: 'gone', taskType: 'water' },
        ],
      },
      createdAt: new Date('2026-11-12T08:00:00Z'),
    });
    await markSent(db, digest.id, 'digest-1');
    await storeTrigger(db, {
      chatId: chat.id,
      externalId: 'old-1',
      senderPersonId: tom.id,
      body: 'is the pothos ok in low light?',
      createdAt: new Date('2026-11-12T09:15:00Z'),
    });
    const message = await storeTrigger(db, {
      chatId: chat.id,
      externalId: 'now-1',
      senderPersonId: anna.id,
      body: 'monstera done',
      quotedMessageId: digest.id,
      createdAt: new Date(NOW.epochMilliseconds),
    });
    if (message === undefined) throw new Error('not stored');

    const context = await buildContext(db, { household, sender: anna, message, now: NOW });

    expect(context.today).toBe(TODAY);
    expect(context.refs.resolve('plant', 'p1')).toBe(pothos.id);
    expect(context.refs.resolve('plant', 'p2')).toBe(monstera.id);
    expect(context.prompt).toBe(
      [
        '<household>',
        'Today: Thu 2026-11-12, 18:40 (Europe/Warsaw)',
        'Settings: daily reminder at 09:00, language en',
        'Members: Anna, Tom',
        'Household notes: [n1] cat chews leaves (2mo)',
        'Plants:',
        '[p1] Pothos · living room',
        '    water every 7d, next Sun 2026-11-15 (in 3d), last done Sun 2026-11-08',
        '[p2] Monstera · bedroom',
        '    water every 9d, overdue 2d (was due Tue 2026-11-10), last done Sun 2026-11-01',
        '    note [n2] broken branch (3wk)',
        '</household>',
        '',
        '<conversation>',
        '[Thu 09:00] Ent: Today: water Monstera (bedroom, 2 days overdue). Reply when done.',
        '[Thu 10:15] Tom: is the pothos ok in low light?',
        '</conversation>',
        '',
        '<message>',
        '[Thu 18:40] Anna: monstera done',
        `(replying to Ent's message: "Today: water Monstera (bedroom, 2 days overdue). Reply when done.")`,
        '(that reminder listed: [p2] water; (archived plant) water)',
        '</message>',
      ].join('\n'),
    );
  });
});
