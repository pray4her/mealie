import { createHash } from 'node:crypto';
import type { FamilyContext, Page, Recipe, RecipeMutation, RecipeUpdate, RecipesApi, RecipeListInput, RecipeFavoriteMutation, RecipeImagesMutation } from 'home-contracts';
import { AppError, consumeRequestLimit, DatabaseFault, safeError } from 'home-kernel';
import type { ContentPort, DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { bindRecipeMedia } from 'home-media';
import { auditText, exact, favoriteMutation, listInput, mutation, recipeId } from './validation';
import { favoriteId, favoriteRecord, isFavorite, readRecipe, recipeCandidate, recipeView } from './repository';
import type { RecipeCursor, RecipeReads, RecipeRecord } from './repository';
import { insertRecipe } from './create';
export { insertRecipe } from './create';
export { recipeInput, auditText } from './validation';
export { createRecipeReads } from './repository';
export type { RecipeReadPlatform, RecipeReads } from './repository';

export interface RecipeDeps { database: DatabasePort; reads: RecipeReads; content: ContentPort; now(): number; newId(): string; revalidateIdentity(): Promise<void> }
type Receipt = { _id: string; uid: string; familyId: string; generation: string; operation: string; requestId: string; payloadHash: string; result: Omit<Recipe, 'isFavorite'> | { error: 'INVALID_INPUT' } | { done: true }; createdAt: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createRecipesService(deps: RecipeDeps, ctx: FamilyContext): RecipesApi {
  async function confirm(tx: TransactionPort) {
    const current = await readFamily(tx, ctx.uid);
    if (!current) throw new AppError('FAMILY_REQUIRED');
    if (current.familyId !== ctx.familyId || current.generation !== ctx.generation || current.role !== ctx.role) throw new AppError('CONFLICT');
  }
  async function prepare(operation: string, write: boolean) {
    await deps.database.transaction(confirm);
    await consumeRequestLimit(deps.database, { subject: 'uid:' + ctx.uid, operation, now: deps.now(), max: write ? 10 : 60 });
    await consumeRequestLimit(deps.database, { subject: 'family:' + ctx.familyId, operation, now: deps.now(), max: write ? 60 : 300 });
  }
  async function receipt(tx: TransactionPort, input: RecipeMutation | RecipeUpdate | RecipeFavoriteMutation | RecipeImagesMutation, operation: string): Promise<Receipt['result'] | null> {
    await confirm(tx);
    const id = hash(['recipe-receipt-v1', ctx.uid, ctx.familyId, ctx.generation, operation, input.requestId]);
    const value = await tx.get<Receipt>('mutation_receipts', id);
    if (!value) return null;
    if (value._id !== id || value.uid !== ctx.uid || value.familyId !== ctx.familyId || value.generation !== ctx.generation || value.operation !== operation
      || value.requestId !== input.requestId || value.payloadHash !== hash(input)) throw new AppError('CONFLICT');
    if (!value.result || typeof value.result !== 'object') throw new AppError('UNAVAILABLE');
    if ('error' in value.result) {
      if (value.result.error !== 'INVALID_INPUT' || Object.keys(value.result).length !== 1) throw new AppError('UNAVAILABLE');
      throw new AppError('INVALID_INPUT');
    }
    return value.result;
  }
  async function replay(tx: TransactionPort, input: RecipeMutation | RecipeUpdate | RecipeImagesMutation, operation: string): Promise<Recipe | null> {
    const result = await receipt(tx, input, operation);
    if (!result) return null;
    if (!('familyId' in result) || result.familyId !== ctx.familyId) throw new AppError('UNAVAILABLE');
    await readRecipe(tx, ctx.familyId, recipeId(result.id));
    return { ...result, isFavorite: await isFavorite(tx, ctx, result.id) };
  }
  async function saveReceipt(tx: TransactionPort, input: RecipeMutation | RecipeUpdate | RecipeFavoriteMutation | RecipeImagesMutation, operation: string, result: Receipt['result']) {
    const receipt: Receipt = { _id: hash(['recipe-receipt-v1', ctx.uid, ctx.familyId, ctx.generation, operation, input.requestId]),
      uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation, operation, requestId: input.requestId, payloadHash: hash(input), result, createdAt: deps.now() };
    await tx.insert('mutation_receipts', receipt._id, receipt);
  }
  async function write(raw: unknown, update: boolean): Promise<Recipe> {
    const edit = update ? mutation(raw, true) : null;
    const input = edit ?? mutation(raw, false);
    if (input.familyId !== ctx.familyId || input.generation !== ctx.generation) throw new AppError('CONFLICT');
    const operation = update ? 'recipe-update-v1' : 'recipe-create-v1';
    await prepare(operation, true);
    const existing = await deps.database.transaction(async tx => {
      const previous = await replay(tx, input, operation);
      if (!previous && edit) {
        const row = await readRecipe(tx, ctx.familyId, edit.id);
        if (row.version !== edit.version) throw new AppError('CONFLICT');
      }
      return previous;
    });
    if (existing) return existing;
    const verdict = await deps.content.checkText(auditText(input.recipe));
    if (verdict !== 'allowed' && verdict !== 'rejected') throw new AppError('UNAVAILABLE');
    if (verdict === 'rejected') {
      await deps.revalidateIdentity();
      let winner: Recipe | null;
      try {
        winner = await deps.database.transaction(async tx => {
          const previous = await replay(tx, input, operation);
          if (previous) return previous;
          await guardMutation(tx, ctx);
          // A terminal rejection fences any earlier call whose audit is still running.
          await saveReceipt(tx, input, operation, { error: 'INVALID_INPUT' });
          return null;
        });
      } catch (error) {
        if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
        winner = await deps.database.transaction(tx => replay(tx, input, operation));
        if (!winner) throw new AppError('UNAVAILABLE');
      }
      if (winner) return winner;
      throw new AppError('INVALID_INPUT');
    }
    await deps.revalidateIdentity();
    const id = edit ? edit.id : recipeId(deps.newId());
    const timestamp = deps.now();
    try {
      return await deps.database.transaction(async tx => {
        const previous = await replay(tx, input, operation);
        if (previous) return previous;
        await guardMutation(tx, ctx);
        let row: RecipeRecord;
        if (edit) {
          const current = await readRecipe(tx, ctx.familyId, edit.id);
          if (current.version !== edit.version) throw new AppError('CONFLICT');
          row = { ...current, ...input.recipe, version: current.version + 1, updatedAt: timestamp };
          await tx.replace('recipes', id, row);
        } else {
          row = await insertRecipe(tx, ctx, input.recipe, id, timestamp);
        }
        const result = await recipeView(tx, row, ctx);
        const { isFavorite: _private, ...snapshot } = result;
        await saveReceipt(tx, input, operation, snapshot);
        return result;
      });
    } catch (error) {
      if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
      await deps.revalidateIdentity();
      const recovered = await deps.database.transaction(tx => replay(tx, input, operation));
      if (!recovered) throw new AppError('UNAVAILABLE');
      return recovered;
    }
  }
  async function get(id: string): Promise<Recipe> {
    recipeId(id); await prepare('recipes:get', false);
    const result = await deps.database.transaction(async tx => { await confirm(tx); return recipeView(tx, await readRecipe(tx, ctx.familyId, id), ctx); });
    await deps.revalidateIdentity(); await deps.database.transaction(confirm); return result;
  }
  async function list(input: RecipeListInput): Promise<Page<Recipe>> {
    const row = listInput(input); const { query, tag, favoritesOnly, limit } = row;
    const scope = hash(['recipe-list-v1', ctx.uid, ctx.familyId, ctx.generation, query, tag, favoritesOnly]);
    await prepare('recipes:list', false);
    let cursor: RecipeCursor | undefined;
    if (row.cursor !== undefined) {
      try {
        if (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor)) throw new Error();
        const value = exact(JSON.parse(Buffer.from(row.cursor, 'base64url').toString()), ['scope', 'createdAt', 'id']);
        if (value.scope !== scope || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new Error();
        cursor = { familyId: ctx.familyId, createdAt: value.createdAt, id: recipeId(value.id) };
      } catch { throw new AppError('INVALID_INPUT'); }
    }
    // shortcut: examine at most 100 metadata rows per request; use a search index if families outgrow incremental search.
    const rows = (await deps.reads.list(ctx.familyId, 100, cursor)).map(recipeCandidate);
    if (rows.length > 101 || rows.some((item, index) => {
      const before = index ? { createdAt: rows[index - 1].createdAt, id: rows[index - 1]._id } : cursor;
      return item.familyId !== ctx.familyId || (before && (item.createdAt > before.createdAt || (item.createdAt === before.createdAt && item._id >= before.id)));
    })) throw new AppError('UNAVAILABLE');
    const candidates = rows.slice(0, 100);
    const favorites = await deps.reads.favorites(ctx, candidates.map(item => item._id)); const favoriteIds = new Set<string>();
    if (favorites.length > candidates.length) throw new AppError('UNAVAILABLE');
    for (const value of favorites) {
      const id = (value as { recipeId?: unknown })?.recipeId;
      if (typeof id !== 'string' || !candidates.some(row => row._id === id) || favoriteIds.has(id) || favoriteRecord(value, ctx, id).generation !== ctx.generation) throw new AppError('UNAVAILABLE');
      favoriteIds.add(id);
    }
    const matches = (item: { title: string; tags: string[] }) => item.title.replace(/[A-Z]/g, letter => letter.toLowerCase()).includes(query) && (!tag || item.tags.includes(tag));
    let examined = 0;
    const items = await deps.database.transaction(async tx => {
      await confirm(tx); const result: Recipe[] = []; examined = 0;
      const selected = [];
      for (const item of candidates) {
        examined++;
        if (matches(item) && (!favoritesOnly || favoriteIds.has(item._id))) selected.push(item);
        if (selected.length === limit) break;
      }
      for (const item of selected) {
        try {
          const current = await readRecipe(tx, ctx.familyId, item._id);
          if (current.createdAt !== item.createdAt) throw new AppError('UNAVAILABLE');
          const view = await recipeView(tx, current, ctx);
          if (matches(view) && (!favoritesOnly || view.isFavorite)) result.push(view);
        } catch (error) { if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error; }
      }
      return result;
    });
    await deps.revalidateIdentity(); await deps.database.transaction(confirm);
    const last = candidates[examined - 1];
    return { items, nextCursor: rows.length > examined && last ? Buffer.from(JSON.stringify({ scope, createdAt: last.createdAt, id: last._id })).toString('base64url') : null };
  }
  async function favorite(raw: unknown): Promise<void> {
    const input = favoriteMutation(raw); const operation = 'recipe-favorite-v1';
    if (input.familyId !== ctx.familyId || input.generation !== ctx.generation) throw new AppError('CONFLICT');
    await prepare(operation, true); await deps.revalidateIdentity();
    async function completed(tx: TransactionPort) {
      const result = await receipt(tx, input, operation);
      if (result && (!('done' in result) || result.done !== true || Object.keys(result).length !== 1)) throw new AppError('UNAVAILABLE');
      return result !== null;
    }
    try {
      await deps.database.transaction(async tx => {
        if (await completed(tx)) return;
        await guardMutation(tx, ctx); await readRecipe(tx, ctx.familyId, input.id);
        const id = favoriteId(ctx, input.id); const previous = await tx.get('recipe_favorites', id);
        if (previous) favoriteRecord(previous, ctx, input.id);
        if (input.enabled) {
          const row = { _id: id, uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation, recipeId: input.id, createdAt: deps.now() };
          if (!previous) await tx.insert('recipe_favorites', id, row);
          else if (!await isFavorite(tx, ctx, input.id)) await tx.replace('recipe_favorites', id, row);
        } else if (previous) await tx.remove('recipe_favorites', id);
        await saveReceipt(tx, input, operation, { done: true });
      });
    } catch (error) {
      if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
      await deps.revalidateIdentity();
      if (!await deps.database.transaction(completed)) throw new AppError('UNAVAILABLE');
    }
  }
  async function bindImages(raw: unknown): Promise<Recipe> {
    const value = exact(raw, ['requestId', 'familyId', 'generation', 'id', 'version', 'imageIds']);
    if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId)
      || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || (value.version as number) >= Number.MAX_SAFE_INTEGER
      || !Array.isArray(value.imageIds) || value.imageIds.length > 20) throw new AppError('INVALID_INPUT');
    const imageIds = value.imageIds.map(recipeId);
    if (new Set(imageIds).size !== imageIds.length) throw new AppError('INVALID_INPUT');
    if (value.familyId !== ctx.familyId || value.generation !== ctx.generation) throw new AppError('CONFLICT');
    const input: RecipeImagesMutation = { requestId: value.requestId, familyId: ctx.familyId, generation: ctx.generation,
      id: recipeId(value.id), version: value.version as number, imageIds };
    const operation = 'recipe-images-v1'; await prepare(operation, true); await deps.revalidateIdentity();
    const execute = () => deps.database.transaction(async tx => {
      const previous = await replay(tx, input, operation); if (previous) return previous;
      await guardMutation(tx, ctx); const row = await readRecipe(tx, ctx.familyId, input.id);
      if (row.version !== input.version) throw new AppError('CONFLICT');
      await bindRecipeMedia(tx, ctx, row._id, row.imageIds, imageIds, deps.now());
      const updated = { ...row, imageIds, version: row.version + 1, updatedAt: deps.now() };
      await tx.replace('recipes', row._id, updated); const result = await recipeView(tx, updated, ctx);
      const { isFavorite: _private, ...snapshot } = result; await saveReceipt(tx, input, operation, snapshot); return result;
    });
    try { return await execute(); }
    catch (error) {
      if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
      await deps.revalidateIdentity(); const recovered = await deps.database.transaction(tx => replay(tx, input, operation));
      if (!recovered) throw new AppError('UNAVAILABLE'); return recovered;
    }
  }
  async function finish<T>(value: T): Promise<T> {
    await deps.revalidateIdentity(); await deps.database.transaction(confirm); return value;
  }
  return {
    async create(input) { try { return await finish(await write(input, false)); } catch (error) { throw safeError(error); } },
    async update(input) { try { return await finish(await write(input, true)); } catch (error) { throw safeError(error); } },
    async get(id) { try { return await get(id); } catch (error) { throw safeError(error); } },
    async list(input) { try { return await list(input); } catch (error) { throw safeError(error); } },
    async favorite(input) { try { await favorite(input); await finish(undefined); } catch (error) { throw safeError(error); } },
    async bindImages(input) { try { return await finish(await bindImages(input)); } catch (error) { throw safeError(error); } },
  };
}
