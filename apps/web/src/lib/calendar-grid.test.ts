import { describe, expect, it } from 'vitest';
import { formatLongDate, mondayOf, monthGrid, shiftMonth, weekdayIndex } from './calendar-grid';

describe('calendar grid', () => {
  it('builds six Monday-first weeks around the month', () => {
    const grid = monthGrid('2026-10-15');
    expect(grid).toHaveLength(42);
    expect(grid[0].date).toBe('2026-09-28');
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31);
    expect(grid.find((c) => c.date === '2026-10-01')?.inMonth).toBe(true);
  });
  it('moves months across year ends and finds weekdays', () => {
    expect(shiftMonth('2026-12-20', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-05', -1)).toBe('2025-12-01');
    expect(weekdayIndex('2026-10-05')).toBe(0);
    expect(weekdayIndex('2026-10-11')).toBe(6);
    expect(mondayOf('2026-10-09')).toBe('2026-10-05');
    expect(formatLongDate('2026-10-03')).toContain('3 Oct');
  });
});
