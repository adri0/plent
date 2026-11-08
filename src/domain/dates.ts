// Calendar dates are ISO strings ('2026-11-12'), as stored in `date` columns. Arithmetic goes
// through Temporal, which is built into Node and handles time zones and DST.

export type IsoDate = string;

export function isIsoDate(value: string): boolean {
  try {
    return Temporal.PlainDate.from(value, { overflow: 'reject' }).toString() === value;
  } catch {
    return false;
  }
}

// The household's calendar date at an instant (now by default).
export function localDate(
  timeZone: string,
  instant: Temporal.Instant = Temporal.Now.instant(),
): IsoDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

// Whole days from `from` to `to`: positive when `to` is later.
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'days' })
    .days;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return Temporal.PlainDate.compare(a, b) >= 0 ? a : b;
}
