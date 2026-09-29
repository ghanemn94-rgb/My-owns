import { describe, it, expect } from 'vitest';
import {
  addWorkingDays,
  isWorkingDay,
  finishFromStart,
  workingDaysBetweenInclusive,
  workingDaySlip,
  localDate,
  localHour,
  onOrNextWorkingDay,
  DEFAULT_CALENDAR,
  assertIsoDate,
} from './calendar';

// 2026-10-01 is a Thursday; 2026-10-02 Friday; 2026-10-03 Saturday; 2026-10-04 Sunday.
describe('working calendar (Asia/Riyadh, proposed Sun–Thu week)', () => {
  it('treats Friday and Saturday as non-working by default', () => {
    expect(isWorkingDay('2026-10-01')).toBe(true); // Thu
    expect(isWorkingDay('2026-10-02')).toBe(false); // Fri
    expect(isWorkingDay('2026-10-03')).toBe(false); // Sat
    expect(isWorkingDay('2026-10-04')).toBe(true); // Sun
  });

  it('adds working days across the weekend and holidays', () => {
    expect(addWorkingDays('2026-10-01', 1)).toBe('2026-10-04');
    const cal = { ...DEFAULT_CALENDAR, holidays: ['2026-10-04'] };
    expect(addWorkingDays('2026-10-01', 1, cal)).toBe('2026-10-05');
    expect(addWorkingDays('2026-10-05', -1, cal)).toBe('2026-10-01');
  });

  it('computes finish dates from start and duration', () => {
    expect(finishFromStart('2026-10-01', 1)).toBe('2026-10-01');
    expect(finishFromStart('2026-10-01', 2)).toBe('2026-10-04');
    expect(finishFromStart('2026-10-02', 1)).toBe('2026-10-04'); // Friday start rolls to Sunday
    expect(finishFromStart('2026-10-01', 0)).toBe('2026-10-01');
  });

  it('counts working days and slips', () => {
    expect(workingDaysBetweenInclusive('2026-10-01', '2026-10-08')).toBe(6); // Thu..Thu next week
    expect(workingDaySlip('2026-10-01', '2026-10-05')).toBe(2);
    expect(workingDaySlip('2026-10-05', '2026-10-01')).toBe(-2);
    expect(onOrNextWorkingDay('2026-10-03')).toBe('2026-10-04');
  });

  it('derives local business dates and hours in Asia/Riyadh from UTC instants', () => {
    // 22:30 UTC on 30 Sep = 01:30 on 1 Oct in Riyadh (UTC+3)
    expect(localDate(new Date('2026-09-30T22:30:00Z'), 'Asia/Riyadh')).toBe('2026-10-01');
    expect(localHour(new Date('2026-09-30T22:30:00Z'), 'Asia/Riyadh')).toBe(1);
  });

  it('rejects invalid dates', () => {
    expect(() => assertIsoDate('2026-02-30')).toThrow();
    expect(() => assertIsoDate('30/09/2026')).toThrow();
  });
});
