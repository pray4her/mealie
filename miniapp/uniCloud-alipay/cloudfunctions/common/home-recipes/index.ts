import { createHash } from 'node:crypto';
import type { FamilyContext, Page, Recipe, RecipeMutation, RecipeUpdate, RecipesApi } from 'home-contracts';
import { AppError, consumeRequestLimit, DatabaseFault, safeError } from 'home-kernel';
import type { ContentPort, DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { auditText, exact, mutation, recipeId } from './validation';
import { readRecipe, recipeRecord, recipeView } from './repository';
import type { RecipeCursor, RecipeReads, RecipeRecord } from './repository';
export { createRecipeReads } from './repository';
export type { RecipeReadPlatform, RecipeReads } from './repository';

export interface RecipeDeps { database: DatabasePort; reads: RecipeReads; content: ContentPort; now(): number; newId(): string; revalidateIdentity(): Promise<void> }
type Receipt = { _id: string; uid: string; familyId: string; generation: string; operation: string; requestId: string; payloadHash: string; result: Recipe | { error: 'INVALID_INPUT' }; createdAt: number };
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
  async function replay(tx: TransactionPort, input: RecipeMutation | RecipeUpdate, operation: string): Promise<Recipe | null> {
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
    if (value.result.familyId !== ctx.familyId) throw new AppError('UNAVAILABLE');
    await readRecipe(tx, ctx.familyId, recipeId(value.result.id));
    return value.result;
  }
  async function saveReceipt(tx: TransactionPort, input: RecipeMutation | RecipeUpdate, operation: string, result: Receipt['result']) {
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
          const prefix = [...input.recipe.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')].slice(0, 80).join('') || 'recipe';
          row = { ...input.recipe, _id: id, slug: prefix + '-' + id, familyId: ctx.familyId, createdBy: ctx.uid, version: 1,
            createdAt: timestamp, updatedAt: timestamp, imageIds: [], source: { kind: 'manual', url: null, importJobId: null, warnings: [] } };
          await tx.insert('recipes', id, row);
        }
        const result = await recipeView(tx, row, ctx.uid);
        await saveReceipt(tx, input, operation, result);
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
    const result = await deps.database.transaction(async tx => { await confirm(tx); return recipeView(tx, await readRecipe(tx, ctx.familyId, id), ctx.uid); });
    await deps.revalidateIdentity(); await deps.database.transaction(confirm); return result;
  }
  async function list(input: { cursor?: string; limit?: number }): Promise<Page<Recipe>> {
    const row = exact(input, [], ['cursor', 'limit']); const limit = row.limit ?? 20;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new AppError('INVALID_INPUT');
    await prepare('recipes:list', false);
    let cursor: RecipeCursor | undefined;
    if (row.cursor !== undefined) {
      try {
        if (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor)) throw new Error();
        const value = exact(JSON.parse(Buffer.from(row.cursor, 'base64url').toString()), ['familyId', 'createdAt', 'id']);
        if (value.familyId !== ctx.familyId || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new Error();
        cursor = { familyId: ctx.familyId, createdAt: value.createdAt, id: recipeId(value.id) };
      } catch { throw new AppError('INVALID_INPUT'); }
    }
    const rows = (await deps.reads.list(ctx.familyId, limit, cursor)).map(recipeRecord);
    if (rows.length > limit + 1 || rows.some((item, index) => {
      const before = index ? { createdAt: rows[index - 1].createdAt, id: rows[index - 1]._id } : cursor;
      return item.familyId !== ctx.familyId || (before && (item.createdAt > before.createdAt || (item.createdAt === before.createdAt && item._id >= before.id)));
    })) throw new AppError('UNAVAILABLE');
    const selected = rows.slice(0, limit); const last = selected.at(-1);
    const items = await deps.database.transaction(async tx => {
      await confirm(tx); const result: Recipe[] = [];
      for (const item of selected) result.push(await recipeView(tx, item, ctx.uid));
      return result;
    });
    await deps.revalidateIdentity(); await deps.database.transaction(confirm);
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ familyId: ctx.familyId, createdAt: last.createdAt, id: last._id })).toString('base64url') : null };
  }
  return {
    async create(input) { try { return await write(input, false); } catch (error) { throw safeError(error); } },
    async update(input) { try { return await write(input, true); } catch (error) { throw safeError(error); } },
    async get(id) { try { return await get(id); } catch (error) { throw safeError(error); } },
    async list(input) { try { return await list(input); } catch (error) { throw safeError(error); } },
  };
}
