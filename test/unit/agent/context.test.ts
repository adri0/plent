import { describe, expect, it } from 'vitest';

import { ageLabel, dayLabel, dueLabel } from '../../../src/agent/context.ts';

describe('context labels', () => {
  it('labels days with their weekday', () => {
    expect(dayLabel('2026-11-15')).toBe('Sun 2026-11-15');
    expect(dayLabel('2026-11-16')).toBe('Mon 2026-11-16');
  });

  it('labels due dates relative to today', () => {
    expect(dueLabel('2026-11-12', '2026-11-12')).toBe('due today');
    expect(dueLabel('2026-11-15', '2026-11-12')).toBe('next Sun 2026-11-15 (in 3d)');
    expect(dueLabel('2026-11-10', '2026-11-12')).toBe('overdue 2d (was due Tue 2026-11-10)');
  });

  it('labels ages roughly', () => {
    const now = Temporal.Instant.from('2026-11-12T12:00:00Z');
    const ago = (days: number) => new Date(now.epochMilliseconds - days * 86_400_000);
    expect(ageLabel(ago(0.5), now)).toBe('today');
    expect(ageLabel(ago(3), now)).toBe('3d');
    expect(ageLabel(ago(21), now)).toBe('3wk');
    expect(ageLabel(ago(70), now)).toBe('2mo');
    expect(ageLabel(ago(400), now)).toBe('1yr');
  });
});
