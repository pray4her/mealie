import { AppError } from '../../shared/errors';

export function normalizeFamilyName(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('INVALID_INPUT');
  const name = value.trim();
  // eslint-disable-next-line no-control-regex -- Explicit control ranges work on Android without Unicode property escapes.
  if (!name || [...name].length > 40 || /[\u0000-\u001F\u007F-\u009F]/.test(name)) throw new AppError('INVALID_INPUT');
  return name;
}
export function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
