import type { IsoDate } from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Calendar date of `now` in the given IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: IsoDate): number {
  const day = toUtc(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface WorkCalendar {
  workingDays: number[];
  holidays: IsoDate[];
}

export function isWorkingDay(date: IsoDate, cal: WorkCalendar): boolean {
  return cal.workingDays.includes(isoWeekday(date)) && !cal.holidays.includes(date);
}

/** Next working day strictly after `date`. */
export function nextWorkingDay(date: IsoDate, cal: WorkCalendar): IsoDate {
  if (cal.workingDays.length === 0) throw new Error('Calendar has no working days');
  let d = addDays(date, 1);
  while (!isWorkingDay(d, cal)) d = addDays(d, 1);
  return d;
}

/** `date` itself if it is a working day, otherwise the next working day. */
export function onOrNextWorkingDay(date: IsoDate, cal: WorkCalendar): IsoDate {
  return isWorkingDay(date, cal) ? date : nextWorkingDay(date, cal);
}

/** Adds `n` working days (n >= 0) to a working-day-aligned start. */
export function addWorkingDays(date: IsoDate, n: number, cal: WorkCalendar): IsoDate {
  let d = onOrNextWorkingDay(date, cal);
  for (let i = 0; i < n; i++) d = nextWorkingDay(d, cal);
  return d;
}

/**
 * Working days elapsed after `from` up to and including `to`.
 * Returns 0 when `to` is on or before `from`. Used for ageing and lateness.
 */
export function workingDaysAfter(from: IsoDate, to: IsoDate, cal: WorkCalendar): number {
  if (to <= from) return 0;
  let count = 0;
  let d = from;
  while (d < to) {
    d = addDays(d, 1);
    if (isWorkingDay(d, cal)) count++;
  }
  return count;
}

/** Working days in [from, to] inclusive. */
export function workingDaysInclusive(from: IsoDate, to: IsoDate, cal: WorkCalendar): number {
  if (to < from) return 0;
  return workingDaysAfter(from, to, cal) + (isWorkingDay(from, cal) ? 1 : 0);
}

/** Excel 1900 date-system serial for an ISO date (Excel's leap-year bug is irrelevant after 1900-03-01). */
export function toExcelSerial(date: IsoDate): number {
  return daysBetween('1899-12-30', date);
}

export function fromExcelSerial(serial: number): IsoDate {
  return addDays('1899-12-30', Math.floor(serial));
}
