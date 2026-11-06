import { AppError } from '../../shared/errors';

export function normalizeFamilyName(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('INVALID_INPUT');
  const name = value.trim();
  if (!name || [...name].length > 40 || /\p{Cc}/u.test(name)) throw new AppError('INVALID_INPUT');
  return name;
}
export function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
