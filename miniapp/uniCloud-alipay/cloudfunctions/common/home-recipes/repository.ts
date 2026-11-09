import { createHash } from 'node:crypto';
import type { FamilyContext, Recipe, RecipeInput } from 'home-contracts';
import { AppError } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import { exact, recipeId, recipeInput, recipeKeys, text } from './validation';

export type RecipeRecord = RecipeInput & Omit<Recipe, keyof RecipeInput | 'id' | 'authorLabel' | 'isFavorite'> & { _id: string; slug: string };
export type RecipeCandidate = Pick<RecipeRecord, '_id' | 'familyId' | 'title' | 'tags' | 'createdAt'>;
export type FavoriteRecord = { _id: string; uid: string; familyId: string; generation: string; recipeId: string; createdAt: number };
export const favoriteId = (ctx: Pick<FamilyContext, 'familyId' | 'uid'>, id: string) => createHash('sha256').update(JSON.stringify(['recipe-favorite-v1', ctx.familyId, ctx.uid, id])).digest('hex');
export type RecipeCursor = { familyId: string; createdAt: number; id: string };
export interface RecipeReads { list(familyId: string, limit: number, after?: RecipeCursor): Promise<unknown[]>; favorites(ctx: FamilyContext, ids: string[]): Promise<unknown[]> }
interface Query { where(filter: Record<string, unknown>): Query; field(fields: Record<string, boolean>): Query; orderBy(field: string, direction: 'desc'): Query; limit(count: number): Query; get(): Promise<unknown> }
export interface RecipeReadPlatform {
  command: { lt(value: string | number): unknown; in(values: string[]): unknown; and(values: Record<string, unknown>[]): Record<string, unknown>; or(values: Record<string, unknown>[]): Record<string, unknown> };
  collection(name: string): Query;
}
export function createRecipeReads(platform: RecipeReadPlatform): RecipeReads {
  async function rows(query: Query) {
    const result = await query.get();
    if (!result || typeof result !== 'object' || ('errCode' in result && result.errCode !== 0) || !('data' in result) || !Array.isArray(result.data)) throw new AppError('UNAVAILABLE');
    return result.data;
  }
  return { async list(familyId, limit, after) {
    const cmd = platform.command;
    const filter = after ? cmd.and([{ familyId }, cmd.or([{ createdAt: cmd.lt(after.createdAt) }, { createdAt: after.createdAt, _id: cmd.lt(after.id) }])]) : { familyId };
    return rows(platform.collection('recipes').where(filter).field({ _id: true, familyId: true, title: true, tags: true, createdAt: true })
      .orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit + 1));
  }, async favorites(ctx, ids) {
    if (!ids.length) return [];
    if (ids.length > 100) throw new AppError('UNAVAILABLE');
    return rows(platform.collection('recipe_favorites').where({ _id: platform.command.in(ids.map(id => favoriteId(ctx, id))),
      uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation }).limit(ids.length));
  } };
}
export function recipeCandidate(value: unknown): RecipeCandidate {
  try {
    const row = exact(value, ['_id', 'familyId', 'title', 'tags', 'createdAt']);
    recipeId(row._id); text(row.familyId, 128); text(row.title, 120);
    if (!Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 0 || !Array.isArray(row.tags) || row.tags.length > 20) throw new Error();
    row.tags.forEach(tag => text(tag, 40)); return row as RecipeCandidate;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function favoriteRecord(value: unknown, ctx: FamilyContext, id: string): FavoriteRecord {
  const row = value as FavoriteRecord;
  if (!row || row._id !== favoriteId(ctx, id) || row.uid !== ctx.uid || row.familyId !== ctx.familyId || row.recipeId !== id
    || typeof row.generation !== 'string' || !row.generation || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0) throw new AppError('UNAVAILABLE');
  return row;
}
export async function isFavorite(tx: TransactionPort, ctx: FamilyContext, id: string): Promise<boolean> {
  const row = await tx.get<FavoriteRecord>('recipe_favorites', favoriteId(ctx, id));
  return row !== null && favoriteRecord(row, ctx, id).generation === ctx.generation;
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
    // Compare normalized values independently of database object field order.
    const keys = [...recipeKeys, 'raw', 'name', 'quantity', 'unit', 'note'];
    if (JSON.stringify(recipeInput(input), keys) !== JSON.stringify(input, keys)) throw new Error();
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
export async function recipeView(tx: TransactionPort, row: RecipeRecord, ctx: FamilyContext): Promise<Recipe> {
  const { _id, slug: _slug, ...data } = row;
  const member = row.createdBy ? await tx.get<{ familyId?: unknown }>('family_members', row.createdBy) : null;
  const authorLabel = !member || member.familyId !== row.familyId ? '已离开成员' : row.createdBy === ctx.uid ? '我' : '家庭成员';
  return { ...data, id: _id, authorLabel, isFavorite: await isFavorite(tx, ctx, _id) };
}
