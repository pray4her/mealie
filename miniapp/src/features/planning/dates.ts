import { AppError } from '../../shared/errors';

export function parseLocalDate(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('INVALID_INPUT');
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) throw new AppError('INVALID_INPUT');
  return value;
}

function utcDate(value: string): Date {
  parseLocalDate(value);
  // Date.UTC remaps years 0–99 to 1900–1999; this setter preserves the calendar year.
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return date;
}
function formatDate(date: Date): string {
  return parseLocalDate(`${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
}

export function beijingToday(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new AppError('INVALID_INPUT');
  return formatDate(new Date(epochMs + 8 * 60 * 60 * 1000));
}

export function shiftLocalDate(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new AppError('INVALID_INPUT');
  const shifted = utcDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatDate(shifted);
}

export function weekDates(date: string): string[] {
  const weekday = (utcDate(date).getUTCDay() + 6) % 7;
  // 0001-01-01 is Monday, so the first week never needs a year-zero prefix.
  let current = shiftLocalDate(date, -weekday);
  const dates: string[] = [];
  for (let day = 0; day < 7; day++) {
    dates.push(current);
    if (current === '9999-12-31') break;
    current = shiftLocalDate(current, 1);
  }
  return dates;
}
