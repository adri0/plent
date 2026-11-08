import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, isIsoDate, localDate } from '../../../src/domain/dates.ts';
import {
  firstDue,
  nextDueAfterDone,
  nextDueAfterIntervalChange,
  nextDueAfterSkip,
} from '../../../src/domain/schedule.ts';

const today = '2026-11-12';

describe('next_due rules', () => {
  describe('first due date', () => {
    it('is the last done date plus the interval', () => {
      expect(firstDue(today, 7, '2026-11-08')).toBe('2026-11-15');
    });

    it('is today plus the interval with no prior done', () => {
      expect(firstDue(today, 9)).toBe('2026-11-21');
    });

    it('can already be overdue when the last done was long ago', () => {
      expect(firstDue(today, 7, '2026-10-20')).toBe('2026-10-27');
    });
  });

  describe('done', () => {
    it('is the event date plus the interval', () => {
      expect(nextDueAfterDone(today, 7)).toBe('2026-11-19');
    });

    it('counts from a backdated event', () => {
      expect(nextDueAfterDone('2026-11-10', 7, '2026-11-01')).toBe('2026-11-17');
    });

    it('never moves back for an event older than the last done', () => {
      expect(nextDueAfterDone('2026-11-01', 7, '2026-11-10')).toBe('2026-11-17');
    });
  });

  describe('skipped', () => {
    it('is today plus the recheck days', () => {
      expect(nextDueAfterSkip(today, 9, 2)).toBe('2026-11-14');
    });

    it('waits a full interval without a recheck', () => {
      expect(nextDueAfterSkip(today, 30)).toBe('2026-12-12');
    });
  });

  describe('interval change', () => {
    it('is the last done date plus the new interval', () => {
      expect(nextDueAfterIntervalChange(today, 10, '2026-11-08')).toBe('2026-11-18');
    });

    it('is today plus the new interval with no prior done', () => {
      expect(nextDueAfterIntervalChange(today, 10)).toBe('2026-11-22');
    });
  });
});

describe('dates', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2028-02-27', 2)).toBe('2028-02-29');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-11-10', '2026-11-12')).toBe(2);
    expect(daysBetween('2026-11-12', '2026-11-10')).toBe(-2);
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-11-12')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('12/11/2026')).toBe(false);
  });

  it("gives the household's local date, not UTC's", () => {
    const instant = Temporal.Instant.from('2026-11-12T23:30:00Z');
    expect(localDate('Europe/Warsaw', instant)).toBe('2026-11-13');
    expect(localDate('America/New_York', instant)).toBe('2026-11-12');
  });

  it('keeps whole days across a DST switch', () => {
    // Europe/Warsaw springs forward on 2026-03-29.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    const beforeSwitch = Temporal.Instant.from('2026-03-28T22:30:00Z');
    expect(localDate('Europe/Warsaw', beforeSwitch)).toBe('2026-03-28');
    const afterSwitch = Temporal.Instant.from('2026-03-29T22:30:00Z');
    expect(localDate('Europe/Warsaw', afterSwitch)).toBe('2026-03-30');
  });
});
