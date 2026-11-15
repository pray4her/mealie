import type { MealType, PlanFields, PlanAdd, PlanUpdate, PlanRemove, PlanEntry, PlanListInput } from 'home-contracts';
import { AppError } from '../../shared/errors';
import { object, validId } from '../recipes/validation';
import { parseLocalDate } from './dates';

export function parseTargetServings(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10000) throw new AppError('INVALID_INPUT');
  return value;
}

export function parseServingsText(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new AppError('INVALID_INPUT');
  return parseTargetServings(Number(value));
}

export function parseMeal(value: unknown): MealType {
  if (value !== 'breakfast' && value !== 'lunch' && value !== 'dinner' && value !== 'other') throw new AppError('INVALID_INPUT');
  return value;
}

export function parsePlanFields(value: unknown): PlanFields {
  const row = object(value, ['date', 'meal', 'targetServings']);
  return { date: parseLocalDate(row.date), meal: parseMeal(row.meal), targetServings: parseTargetServings(row.targetServings) };
}

function text(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- Match server control checks without Android Unicode property escapes.
  if (typeof value !== 'string' || !value || value.trim() !== value || [...value].length > max || /[\u0000-\u001F\u007F-\u009F]/.test(value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new AppError('INVALID_INPUT');
  return value;
}
export type PlanIntent = { kind: 'add'; input: PlanAdd } | { kind: 'update'; input: PlanUpdate } | { kind: 'remove'; input: PlanRemove };
export function parsePlanIntent(value: unknown): PlanIntent {
  const intent = object(value, ['kind', 'input']); const kind = intent.kind;
  if (kind !== 'add' && kind !== 'update' && kind !== 'remove') throw new AppError('INVALID_INPUT');
  const row = object(intent.input, ['requestId', 'familyId', 'generation', ...(kind === 'add' ? ['recipeId'] : ['id', 'version']),
    ...(kind === 'remove' ? [] : ['date', 'meal', 'targetServings'])]);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)) throw new AppError('INVALID_INPUT');
  const scope = { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128) };
  const fields = () => parsePlanFields({ date: row.date, meal: row.meal, targetServings: row.targetServings });
  if (kind === 'add') return { kind, input: { ...scope, recipeId: validId(row.recipeId), ...fields() } };
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= Number.MAX_SAFE_INTEGER) throw new AppError('INVALID_INPUT');
  const target = { ...scope, id: validId(row.id), version: row.version };
  return kind === 'remove' ? { kind, input: target } : { kind, input: { ...target, ...fields() } };
}
export function parsePlanList(value: unknown): PlanListInput & { limit: number } {
  const row = object(value, ['from', 'to'], ['cursor', 'limit']); const from = parseLocalDate(row.from); const to = parseLocalDate(row.to);
  // ISO full years are parsed literally (including 0001..0099), with UTC midnight, never device-local time.
  const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  const limit = row.limit === undefined ? 20 : row.limit;
  if (days < 0 || days > 30 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20
    || row.cursor !== undefined && (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor))) throw new AppError('INVALID_INPUT');
  return { from, to, limit, ...(row.cursor === undefined ? {} : { cursor: row.cursor as string }) };
}
export function parsePlanEntry(value: unknown): PlanEntry {
  try {
    const row = object(value, ['id', 'familyId', 'createdBy', 'recipeId', 'titleSnapshot', 'version', 'createdAt', 'updatedAt', 'sourceAvailable', 'coverImageId', 'date', 'meal', 'targetServings']);
    for (const name of ['version', 'createdAt', 'updatedAt']) if (typeof row[name] !== 'number' || !Number.isSafeInteger(row[name]) || (row[name] as number) < (name === 'version' ? 1 : 0)) throw new Error();
    if ((row.updatedAt as number) < (row.createdAt as number) || typeof row.sourceAvailable !== 'boolean' || !row.sourceAvailable && row.coverImageId !== null) throw new Error();
    return { id: validId(row.id), familyId: text(row.familyId, 128), createdBy: row.createdBy === null ? null : text(row.createdBy, 128),
      recipeId: validId(row.recipeId), titleSnapshot: text(row.titleSnapshot, 120), version: row.version as number, createdAt: row.createdAt as number, updatedAt: row.updatedAt as number,
      sourceAvailable: row.sourceAvailable, coverImageId: row.coverImageId === null ? null : validId(row.coverImageId),
      ...parsePlanFields({ date: row.date, meal: row.meal, targetServings: row.targetServings }) };
  } catch { throw new AppError('UNAVAILABLE'); }
}
