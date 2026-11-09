import type { Recipe, RecipeInput } from 'home-contracts';
import { AppError } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import { exact, recipeId, recipeInput, recipeKeys, text } from './validation';

export type RecipeRecord = RecipeInput & Omit<Recipe, keyof RecipeInput | 'id' | 'authorLabel'> & { _id: string; slug: string };
export type RecipeCursor = { familyId: string; createdAt: number; id: string };
export interface RecipeReads { list(familyId: string, limit: number, after?: RecipeCursor): Promise<unknown[]> }
interface Query { where(filter: Record<string, unknown>): Query; orderBy(field: string, direction: 'desc'): Query; limit(count: number): Query; get(): Promise<unknown> }
export interface RecipeReadPlatform {
  command: { lt(value: string | number): unknown; and(values: Record<string, unknown>[]): Record<string, unknown>; or(values: Record<string, unknown>[]): Record<string, unknown> };
  collection(name: string): Query;
}
export function createRecipeReads(platform: RecipeReadPlatform): RecipeReads {
  return { async list(familyId, limit, after) {
    const cmd = platform.command;
    const filter = after ? cmd.and([{ familyId }, cmd.or([{ createdAt: cmd.lt(after.createdAt) }, { createdAt: after.createdAt, _id: cmd.lt(after.id) }])]) : { familyId };
    const result = await platform.collection('recipes').where(filter).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit + 1).get();
    if (!result || typeof result !== 'object' || ('errCode' in result && result.errCode !== 0) || !('data' in result) || !Array.isArray(result.data)) throw new AppError('UNAVAILABLE');
    return result.data;
  } };
}
export function recipeRecord(value: unknown): RecipeRecord {
  try {
    const row = exact(value, [...recipeKeys, '_id', 'slug', 'familyId', 'createdBy', 'version', 'createdAt', 'updatedAt', 'imageIds', 'source']);
    recipeId(row._id); text(row.slug, 200); text(row.familyId, 128);
    if (row.createdBy !== null) text(row.createdBy, 128);
    for (const key of ['version', 'createdAt', 'updatedAt']) if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || (row[key] as number) < (key === 'version' ? 1 : 0)) throw new Error();
    if (!Array.isArray(row.imageIds) || row.imageIds.length > 20 || row.imageIds.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new Error();
    const source = exact(row.source, ['kind', 'url', 'importJobId', 'warnings']);
    if (!['manual', 'text', 'image', 'url'].includes(String(source.kind)) || (source.url !== null && typeof source.url !== 'string')
      || (source.importJobId !== null && typeof source.importJobId !== 'string') || !Array.isArray(source.warnings)
      || source.warnings.length > 20 || source.warnings.some(v => typeof v !== 'string' || v.length > 2000)) throw new Error();
    const input = Object.fromEntries(recipeKeys.map(key => [key, row[key]]));
    if (JSON.stringify(recipeInput(input)) !== JSON.stringify(input)) throw new Error();
    return row as unknown as RecipeRecord;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export async function readRecipe(tx: TransactionPort, familyId: string, id: string): Promise<RecipeRecord> {
  const value = await tx.get<{ familyId?: unknown }>('recipes', id);
  if (!value || value.familyId !== familyId) throw new AppError('NOT_FOUND');
  const row = recipeRecord(value);
  if (row._id !== id) throw new AppError('UNAVAILABLE');
  return row;
}
export async function recipeView(tx: TransactionPort, row: RecipeRecord, uid: string): Promise<Recipe> {
  const { _id, slug: _slug, ...data } = row;
  const member = row.createdBy ? await tx.get<{ familyId?: unknown }>('family_members', row.createdBy) : null;
  const authorLabel = !member || member.familyId !== row.familyId ? '已离开成员' : row.createdBy === uid ? '我' : '家庭成员';
  return { ...data, id: _id, authorLabel };
}
