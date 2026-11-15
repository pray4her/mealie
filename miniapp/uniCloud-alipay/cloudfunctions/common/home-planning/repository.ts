import type { PlanEntry } from 'home-contracts';
import { AppError } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import { readRecipe } from 'home-recipes';
import { exact, parseLocalDate, parsePlanFields, planId, text } from './validation';

export type PlanRecord = Omit<PlanEntry, 'id' | 'sourceAvailable' | 'coverImageId'> & { _id: string };
export type PlanCandidate = Pick<PlanRecord, '_id' | 'familyId' | 'date' | 'createdAt'>;
export type PlanCursor = { date: string; createdAt: number; id: string };
export interface PlanningReads {
  list(familyId: string, from: string, to: string, limit: number, after?: PlanCursor): Promise<unknown[]>;
}
interface Query {
  where(filter: Record<string, unknown>): Query; field(fields: Record<string, boolean>): Query;
  orderBy(field: string, direction: 'asc'): Query; limit(count: number): Query; get(): Promise<unknown>;
}
export interface PlanningReadPlatform {
  command: {
    gt(value: string | number): unknown; gte(value: string): unknown; lte(value: string): unknown;
    and(values: Record<string, unknown>[]): Record<string, unknown>; or(values: Record<string, unknown>[]): Record<string, unknown>;
  };
  collection(name: string): Query;
}
export function createPlanningReads(platform: PlanningReadPlatform): PlanningReads {
  return { async list(familyId, from, to, limit, after) {
    const cmd = platform.command;
    const clauses: Record<string, unknown>[] = [{ familyId }, { date: cmd.gte(from) }, { date: cmd.lte(to) }];
    if (after) clauses.push(cmd.or([
      { date: cmd.gt(after.date) },
      { date: after.date, createdAt: cmd.gt(after.createdAt) },
      { date: after.date, createdAt: after.createdAt, _id: cmd.gt(after.id) },
    ]));
    const result = await platform.collection('meal_plans').where(cmd.and(clauses))
      .field({ _id: true, familyId: true, date: true, createdAt: true })
      .orderBy('date', 'asc').orderBy('createdAt', 'asc').orderBy('_id', 'asc').limit(limit + 1).get();
    if (!result || typeof result !== 'object' || ('errCode' in result && result.errCode !== 0)
      || !('data' in result) || !Array.isArray(result.data)) throw new AppError('UNAVAILABLE');
    return result.data;
  } };
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AppError('UNAVAILABLE');
  return value;
}
export function planCandidate(value: unknown): PlanCandidate {
  try {
    const row = exact(value, ['_id', 'familyId', 'date', 'createdAt']);
    planId(row._id); text(row.familyId, 128); parseLocalDate(row.date); timestamp(row.createdAt);
    return row as PlanCandidate;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function planRecord(value: unknown): PlanRecord {
  try {
    const row = exact(value, ['_id', 'familyId', 'createdBy', 'recipeId', 'titleSnapshot', 'version', 'createdAt', 'updatedAt', 'date', 'meal', 'targetServings']);
    planId(row._id); text(row.familyId, 128); planId(row.recipeId); text(row.titleSnapshot, 120);
    if (row.createdBy !== null) text(row.createdBy, 128);
    if (timestamp(row.version) < 1) throw new Error();
    timestamp(row.createdAt); timestamp(row.updatedAt);
    parsePlanFields({ date: row.date, meal: row.meal, targetServings: row.targetServings });
    return row as PlanRecord;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export async function readPlan(tx: TransactionPort, familyId: string, id: string): Promise<PlanRecord> {
  const value = await tx.get<{ familyId?: unknown }>('meal_plans', id);
  if (!value || value.familyId !== familyId) throw new AppError('NOT_FOUND');
  const row = planRecord(value);
  if (row._id !== id) throw new AppError('UNAVAILABLE');
  return row;
}
export async function planView(tx: TransactionPort, row: PlanRecord): Promise<PlanEntry> {
  const { _id, ...data } = row;
  try {
    const source = await readRecipe(tx, row.familyId, row.recipeId);
    return { ...data, id: _id, sourceAvailable: true, coverImageId: source.imageIds[0] ?? null };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
    return { ...data, id: _id, sourceAvailable: false, coverImageId: null };
  }
}
export function planSnapshot(value: unknown): PlanEntry {
  try {
    const row = exact(value, ['id', 'familyId', 'createdBy', 'recipeId', 'titleSnapshot', 'version', 'createdAt', 'updatedAt', 'date', 'meal', 'targetServings', 'sourceAvailable', 'coverImageId']);
    const { id, sourceAvailable, coverImageId, ...data } = row;
    planRecord({ ...data, _id: id });
    if (typeof sourceAvailable !== 'boolean' || (!sourceAvailable && coverImageId !== null)) throw new Error();
    if (coverImageId !== null) text(coverImageId, 128);
    return row as PlanEntry;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function position(row: PlanCandidate): PlanCursor { return { date: row.date, createdAt: row.createdAt, id: row._id }; }
export function comparePosition(a: PlanCursor, b: PlanCursor): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
