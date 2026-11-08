import type { Db } from '../db/client.ts';
import type { Household } from '../db/schema.ts';
import { DomainError } from './errors.ts';

// A household's reminder time, time zone and language. A changed reminder time applies from
// the next day when today's digest has gone out; that's the scheduler's concern.

export interface SettingsChanges {
  reminderTime?: string | undefined; // HH:MM, 24-hour
  timezone?: string | undefined; // IANA name, e.g. Europe/Warsaw
  language?: string | undefined; // ISO 639-1, e.g. en
}

export async function updateSettings(
  db: Db,
  householdId: string,
  changes: SettingsChanges,
): Promise<Household> {
  const set: { reminder_time?: string; timezone?: string; language?: string } = {};
  if (changes.reminderTime !== undefined)
    set.reminder_time = parseReminderTime(changes.reminderTime);
  if (changes.timezone !== undefined) set.timezone = parseTimeZone(changes.timezone);
  if (changes.language !== undefined) set.language = parseLanguage(changes.language);
  if (Object.keys(set).length === 0) {
    throw new DomainError(
      'invalid_input',
      'nothing to change: give reminder_time, timezone or language',
    );
  }
  const household = await db
    .updateTable('households')
    .set(set)
    .where('id', '=', householdId)
    .returningAll()
    .executeTakeFirst();
  if (household === undefined) throw new DomainError('not_found', 'no such household');
  return household;
}

export function parseReminderTime(value: string): string {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (match === null)
    throw new DomainError('invalid_input', 'reminder_time must be HH:MM, e.g. 08:30');
  return `${(match[1] ?? '').padStart(2, '0')}:${match[2] ?? ''}`;
}

// The canonical IANA name ("europe/warsaw" → "Europe/Warsaw").
export function parseTimeZone(value: string): string {
  try {
    return Temporal.Now.zonedDateTimeISO(value.trim()).timeZoneId;
  } catch {
    throw new DomainError(
      'invalid_input',
      `unknown time zone ${value}: use an IANA name like Europe/Warsaw`,
    );
  }
}

export function parseLanguage(value: string): string {
  const code = value.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) {
    throw new DomainError('invalid_input', 'language must be a two-letter ISO 639-1 code, e.g. en');
  }
  return code;
}
