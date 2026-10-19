import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  fromExcelSerial,
  isIsoDate,
  nextWorkingDay,
  toExcelSerial,
  todayIn,
  weekStart,
  workingDaysAfter,
} from '../src';

const cal = { workingDays: [1, 2, 3, 4, 5], holidays: ['2026-10-20'] };

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-01')).toBe(false);
  });

  it('computes today in the org timezone, not UTC', () => {
    // 20:00 UTC on the 19th is already the 20th in India.
    expect(todayIn('Asia/Kolkata', new Date('2026-10-19T20:00:00Z'))).toBe('2026-10-20');
    expect(todayIn('UTC', new Date('2026-10-19T20:00:00Z'))).toBe('2026-10-19');
  });

  it('skips weekends and holidays', () => {
    expect(nextWorkingDay('2026-10-19', cal)).toBe('2026-10-21'); // Tue is a holiday
    expect(nextWorkingDay('2026-10-23', cal)).toBe('2026-10-26'); // Fri -> Mon
    expect(addWorkingDays('2026-10-17', 0, cal)).toBe('2026-10-19'); // Sat aligns to Mon
    expect(workingDaysAfter('2026-10-16', '2026-10-21', cal)).toBe(2); // Mon, Wed
  });

  it('supports a six-day working week', () => {
    expect(nextWorkingDay('2026-10-23', { workingDays: [1, 2, 3, 4, 5, 6], holidays: [] })).toBe(
      '2026-10-24',
    );
  });

  it('round-trips Excel serial dates', () => {
    expect(toExcelSerial('2026-10-19')).toBe(46314);
    expect(fromExcelSerial(46314)).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
  });
});
