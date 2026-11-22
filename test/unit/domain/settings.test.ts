import { describe, expect, it } from 'vitest';

import { parseLanguage, parseReminderTime, parseTimeZone } from '../../../src/domain/settings.ts';

describe('settings parsing', () => {
  it.each([
    ['9:00', '09:00'],
    ['08:30', '08:30'],
    [' 23:59 ', '23:59'],
  ])('reminder time %j → %j', (input, expected) => {
    expect(parseReminderTime(input)).toBe(expected);
  });

  it.each(['24:00', '9', '9am', '09:60'])('refuses reminder time %j', (input) => {
    expect(() => parseReminderTime(input)).toThrow(/HH:MM/);
  });

  it('canonicalises time zones and refuses unknown ones', () => {
    expect(parseTimeZone('europe/warsaw')).toBe('Europe/Warsaw');
    expect(parseTimeZone('UTC')).toBe('UTC');
    expect(() => parseTimeZone('Mars/Olympus')).toThrow(/unknown time zone/);
  });

  it('takes two-letter language codes', () => {
    expect(parseLanguage('PL')).toBe('pl');
    expect(() => parseLanguage('polish')).toThrow(/two-letter/);
  });
});
