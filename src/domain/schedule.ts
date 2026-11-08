import { addDays, maxDate, type IsoDate } from './dates.ts';

// The `next_due` rules from the design doc. `next_due` is stored, so each change to a schedule
// or its history goes through one of these.

// A schedule's first due date: the last time it was done plus the interval, or today plus the
// interval when it has never been done (e.g. a new plant whose last watering is unknown).
export function firstDue(today: IsoDate, intervalDays: number, lastDone?: IsoDate): IsoDate {
  return addDays(lastDone ?? today, intervalDays);
}

// Done: the latest done date plus the interval. A late-logged older "done" never moves the
// schedule back.
export function nextDueAfterDone(
  doneOn: IsoDate,
  intervalDays: number,
  previousDone?: IsoDate,
): IsoDate {
  return addDays(previousDone === undefined ? doneOn : maxDate(doneOn, previousDone), intervalDays);
}

// Skipped ("soil still wet"): check again after `recheckInDays`; without one, the task waits a
// full interval from today.
export function nextDueAfterSkip(
  today: IsoDate,
  intervalDays: number,
  recheckInDays?: number,
): IsoDate {
  return addDays(today, recheckInDays ?? intervalDays);
}

// Interval change: the last done date plus the new interval, or today plus it if never done.
export function nextDueAfterIntervalChange(
  today: IsoDate,
  intervalDays: number,
  lastDone?: IsoDate,
): IsoDate {
  return firstDue(today, intervalDays, lastDone);
}
