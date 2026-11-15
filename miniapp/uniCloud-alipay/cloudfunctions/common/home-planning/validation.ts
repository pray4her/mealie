import type { MealType, PlanAdd, PlanFields, PlanListInput, PlanRemove, PlanUpdate } from 'home-contracts';
import { AppError } from 'home-kernel';

export function parseLocalDate(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('INVALID_INPUT');
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) throw new AppError('INVALID_INPUT');
  return value;
}

export function parseTargetServings(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10000) throw new AppError('INVALID_INPUT');
  return value;
}

export function parseMeal(value: unknown): MealType {
  if (value !== 'breakfast' && value !== 'lunch' && value !== 'dinner' && value !== 'other') throw new AppError('INVALID_INPUT');
  return value;
}

export function parsePlanFields(value: unknown): PlanFields {
  const keys = ['date', 'meal', 'targetServings'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) throw new AppError('INVALID_INPUT');
  const row = value as Record<string, unknown>;
  return { date: parseLocalDate(row.date), meal: parseMeal(row.meal), targetServings: parseTargetServings(row.targetServings) };
}

export function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...keys, ...optional].includes(key))) throw new AppError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function planId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new AppError('INVALID_INPUT');
  return value;
}
export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || [...value].length > max || /\p{Cc}/u.test(value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new AppError('INVALID_INPUT');
  return value;
}
export function mutation(value: unknown, operation: 'add'): PlanAdd;
export function mutation(value: unknown, operation: 'update'): PlanUpdate;
export function mutation(value: unknown, operation: 'remove'): PlanRemove;
export function mutation(value: unknown, operation: 'add' | 'update' | 'remove'): PlanAdd | PlanUpdate | PlanRemove;
export function mutation(value: unknown, operation: 'add' | 'update' | 'remove'): PlanAdd | PlanUpdate | PlanRemove {
  const row = exact(value, ['requestId', 'familyId', 'generation', ...(operation === 'add' ? ['recipeId'] : ['id', 'version']),
    ...(operation === 'remove' ? [] : ['date', 'meal', 'targetServings'])]);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)) throw new AppError('INVALID_INPUT');
  const scope = { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128) };
  const fields = operation === 'remove' ? null : parsePlanFields({ date: row.date, meal: row.meal, targetServings: row.targetServings });
  if (operation === 'add') return { ...scope, recipeId: planId(row.recipeId), ...fields! };
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= Number.MAX_SAFE_INTEGER) throw new AppError('INVALID_INPUT');
  const target = { ...scope, id: planId(row.id), version: row.version };
  return operation === 'remove' ? target : { ...target, ...fields! };
}
// Gregorian ordinal, independent of timezone and Date's special handling of years 0..99.
function dayNumber(date: string): number {
  const year = Number(date.slice(0, 4)); const month = Number(date.slice(5, 7)); const previous = year - 1;
  const beforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const leap = month > 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0;
  return previous * 365 + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400)
    + beforeMonth[month - 1] + leap + Number(date.slice(8, 10));
}
export function listInput(value: unknown): PlanListInput & { limit: number } {
  const row = exact(value, ['from', 'to'], ['cursor', 'limit']);
  const from = parseLocalDate(row.from); const to = parseLocalDate(row.to); const days = dayNumber(to) - dayNumber(from);
  const limit = row.limit === undefined ? 20 : row.limit;
  if (days < 0 || days > 30 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20
    || row.cursor !== undefined && (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor))) throw new AppError('INVALID_INPUT');
  return { from, to, limit, ...(row.cursor === undefined ? {} : { cursor: row.cursor as string }) };
}
