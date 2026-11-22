import type { Db } from '../db/client.ts';
import type { Household, Plant, PlantNote, TaskType } from '../db/schema.ts';
import { daysBetween, localDate, type IsoDate } from '../domain/dates.ts';
import { listMembers, type Person } from '../domain/households.ts';
import {
  getMessage,
  isDigestPayload,
  recentHistory,
  type HistoryLine,
  type Message,
} from '../domain/messages.ts';
import { listActiveNotes } from '../domain/notes.ts';
import { listActivePlants, listSchedules } from '../domain/plants.ts';
import { BOT_NAME } from '../index.ts';
import { RefMap } from './refs.ts';

// Builds what the model sees for one trigger, ordered from stable to dynamic so the system
// prompt stays a cacheable prefix: the household block (date, settings, members, plants with
// refs, notes), the recent conversation, then the message itself with what it quotes.

export interface AgentContext {
  today: IsoDate;
  refs: RefMap;
  prompt: string; // everything after the system prompt
}

export interface ContextInput {
  household: Household;
  sender: Person;
  message: Message; // the stored trigger
  now: Temporal.Instant;
}

export async function buildContext(db: Db, input: ContextInput): Promise<AgentContext> {
  const { household, message, now } = input;
  const zone = household.timezone;
  const today = localDate(zone, now);
  const refs = new RefMap();

  const [members, plants, schedules, notes, lastDone, history, quoted] = await Promise.all([
    listMembers(db, household.id),
    listActivePlants(db, household.id),
    listSchedules(db, household.id),
    listActiveNotes(db, household.id),
    lastDoneByPlant(db, household.id),
    recentHistory(db, message.chat_id, message),
    message.quoted_message_id === null ? undefined : getMessage(db, message.quoted_message_id),
  ]);

  for (const plant of plants) refs.add('plant', plant.id);
  for (const note of notes) refs.add('note', note.id);

  const block = householdBlock({
    household,
    now,
    today,
    members,
    plants,
    schedules,
    notes,
    lastDone,
    refs,
  });
  const sections = [
    `<household>\n${block}\n</household>`,
    history.length === 0
      ? '<conversation>\n(nothing yet)\n</conversation>'
      : `<conversation>\n${history.map((h) => historyLine(h, zone)).join('\n')}\n</conversation>`,
    `<message>\n${currentMessage(input, quoted, refs)}\n</message>`,
  ];
  return { today, refs, prompt: sections.join('\n\n') };
}

interface BlockInput {
  household: Household;
  now: Temporal.Instant;
  today: IsoDate;
  members: Person[];
  plants: Plant[];
  schedules: { plant_id: string; task_type: TaskType; interval_days: number; next_due: IsoDate }[];
  notes: PlantNote[];
  lastDone: Map<string, IsoDate>; // `${plantId}:${taskType}`
  refs: RefMap;
}

export function householdBlock(b: BlockInput): string {
  const zoned = b.now.toZonedDateTimeISO(b.household.timezone);
  const time = zoned.toPlainTime().toString({ smallestUnit: 'minute' });
  const lines = [
    `Today: ${dayLabel(b.today)}, ${time} (${b.household.timezone})`,
    `Settings: daily reminder at ${b.household.reminder_time.slice(0, 5)}, language ${b.household.language}`,
    `Members: ${b.members.length === 0 ? '(none yet)' : b.members.map((m) => m.display_name).join(', ')}`,
  ];

  const householdNotes = b.notes.filter((n) => n.plant_id === null);
  lines.push(
    `Household notes: ${householdNotes.length === 0 ? '(none)' : householdNotes.map((n) => noteLabel(n, b)).join('; ')}`,
  );

  if (b.plants.length === 0) {
    lines.push('Plants: (none yet)');
    return lines.join('\n');
  }
  lines.push('Plants:');
  for (const plant of b.plants) {
    const ref = b.refs.refOf(plant.id) ?? '?';
    const head = [`[${ref}] ${plant.name}`];
    if (plant.species !== null) head.push(plant.species);
    head.push(plant.room ?? 'no room set');
    lines.push(head.join(' · '));
    const own = b.schedules.filter((s) => s.plant_id === plant.id);
    if (own.length === 0) lines.push('    no care schedule');
    for (const s of own) {
      const last = b.lastDone.get(`${plant.id}:${s.task_type}`);
      lines.push(
        `    ${s.task_type} every ${String(s.interval_days)}d, ${dueLabel(s.next_due, b.today)}, last done ${last === undefined ? 'never' : dayLabel(last)}`,
      );
    }
    for (const note of b.notes.filter((n) => n.plant_id === plant.id)) {
      lines.push(`    note ${noteLabel(note, b)}`);
    }
  }
  return lines.join('\n');
}

function currentMessage(input: ContextInput, quoted: Message | undefined, refs: RefMap): string {
  const lines = [
    `${timeLabel(input.message.created_at, input.household.timezone)} ${input.sender.display_name}: ${input.message.body ?? ''}`,
  ];
  if (quoted !== undefined) {
    const who = quoted.direction === 'out' ? BOT_NAME : 'a member';
    lines.push(`(replying to ${who}'s message: "${quoted.body ?? ''}")`);
    if (quoted.kind === 'digest' && isDigestPayload(quoted.payload)) {
      const items = quoted.payload.items.map((item) => {
        const ref = refs.refOf(item.plantId);
        return ref === undefined
          ? `(archived plant) ${item.taskType}`
          : `[${ref}] ${item.taskType}`;
      });
      lines.push(`(that reminder listed: ${items.join('; ')})`);
    }
  }
  return lines.join('\n');
}

function historyLine(line: HistoryLine, zone: string): string {
  return `${timeLabel(line.createdAt, zone)} ${line.senderName ?? BOT_NAME}: ${line.body}`;
}

async function lastDoneByPlant(db: Db, householdId: string): Promise<Map<string, IsoDate>> {
  const rows = await db
    .selectFrom('care_events')
    .innerJoin('plants', 'plants.id', 'care_events.plant_id')
    .select(['care_events.plant_id as plantId', 'care_events.task_type as taskType'])
    .select((eb) => eb.fn.max('care_events.occurred_on').as('last'))
    .where('plants.household_id', '=', householdId)
    .where('plants.status', '=', 'active')
    .where('care_events.action', '=', 'done')
    .groupBy(['care_events.plant_id', 'care_events.task_type'])
    .execute();
  return new Map(rows.map((r) => [`${r.plantId}:${r.taskType}`, r.last]));
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "Sun 2026-11-15": the weekday helps the model with "on Sunday", the ISO date with tools.
export function dayLabel(date: IsoDate): string {
  return `${WEEKDAYS[Temporal.PlainDate.from(date).dayOfWeek - 1] ?? ''} ${date}`;
}

export function dueLabel(nextDue: IsoDate, today: IsoDate): string {
  const days = daysBetween(today, nextDue);
  if (days === 0) return `due today`;
  if (days < 0) return `overdue ${String(-days)}d (was due ${dayLabel(nextDue)})`;
  return `next ${dayLabel(nextDue)} (in ${String(days)}d)`;
}

function noteLabel(note: PlantNote, b: BlockInput): string {
  return `[${b.refs.refOf(note.id) ?? '?'}] ${note.body} (${ageLabel(note.created_at, b.now)})`;
}

// How old something is, roughly: today, 3d, 2wk, 4mo, 1yr.
export function ageLabel(createdAt: Date, now: Temporal.Instant): string {
  const days = Math.floor((now.epochMilliseconds - createdAt.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 14) return `${String(days)}d`;
  if (days < 60) return `${String(Math.floor(days / 7))}wk`;
  if (days < 365) return `${String(Math.floor(days / 30))}mo`;
  return `${String(Math.floor(days / 365))}yr`;
}

function timeLabel(at: Date, zone: string): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(zone);
  const day = WEEKDAYS[zoned.dayOfWeek - 1] ?? '';
  return `[${day} ${zoned.toPlainTime().toString({ smallestUnit: 'minute' })}]`;
}
