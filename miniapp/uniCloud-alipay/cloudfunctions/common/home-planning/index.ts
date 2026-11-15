import { createHash } from 'node:crypto';
import type { FamilyContext, Page, PlanAdd, PlanEntry, PlanRemove, PlanUpdate, PlanningApi } from 'home-contracts';
import { AppError, consumeRequestLimit, DatabaseFault, safeError } from 'home-kernel';
import type { DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { readRecipe } from 'home-recipes';
import { exact, listInput, mutation, parseLocalDate, planId } from './validation';
import { comparePosition, planCandidate, planRecord, planSnapshot, planView, position, readPlan } from './repository';
import type { PlanCursor, PlanningReads, PlanRecord } from './repository';
export { createPlanningReads } from './repository';
export type { PlanningReadPlatform, PlanningReads, PlanRecord, PlanCursor } from './repository';

export interface PlanningDeps { database: DatabasePort; reads: PlanningReads; now(): number; newId(): string; revalidateIdentity(): Promise<void> }
type Operation = 'plan-add-v1' | 'plan-update-v1' | 'plan-remove-v1';
type Input = PlanAdd | PlanUpdate | PlanRemove;
type Result = PlanEntry | { done: true };
type Receipt = { _id: string; uid: string; familyId: string; generation: string; operation: Operation; requestId: string; payloadHash: string; result: Result; createdAt: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createPlanningService(deps: PlanningDeps, ctx: FamilyContext): PlanningApi {
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
  const receiptId = (input: Input, operation: Operation) => hash(['plan-v1', ctx.uid, ctx.familyId, ctx.generation, operation, input.requestId]);
  async function replay(tx: TransactionPort, input: Input, operation: Operation): Promise<Result | null> {
    await confirm(tx);
    const id = receiptId(input, operation); const row = await tx.get<Receipt>('mutation_receipts', id);
    if (!row) return null;
    if (row._id !== id || row.uid !== ctx.uid || row.familyId !== ctx.familyId || row.generation !== ctx.generation
      || row.operation !== operation || row.requestId !== input.requestId || row.payloadHash !== hash(input)) throw new AppError('CONFLICT');
    if (operation === 'plan-remove-v1') {
      if (!row.result || !('done' in row.result) || row.result.done !== true || Object.keys(row.result).length !== 1) throw new AppError('UNAVAILABLE');
      return { done: true };
    }
    const result = planSnapshot(row.result);
    if (result.familyId !== ctx.familyId || ('id' in input && result.id !== input.id)
      || ('recipeId' in input && result.recipeId !== input.recipeId)) throw new AppError('UNAVAILABLE');
    // A receipt acknowledges the original result, not the current entry/source state.
    return result;
  }
  async function saveReceipt(tx: TransactionPort, input: Input, operation: Operation, result: Result) {
    const row: Receipt = { _id: receiptId(input, operation), uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation,
      operation, requestId: input.requestId, payloadHash: hash(input), result, createdAt: deps.now() };
    await tx.insert('mutation_receipts', row._id, row);
  }
  async function write(raw: unknown, kind: 'add' | 'update' | 'remove'): Promise<Result> {
    const input = mutation(raw, kind); const operation: Operation = `plan-${kind}-v1`;
    if (input.familyId !== ctx.familyId || input.generation !== ctx.generation) throw new AppError('CONFLICT');
    await prepare(operation, true); await deps.revalidateIdentity();
    const id = 'id' in input ? input.id : planId(deps.newId()); const timestamp = deps.now();
    try {
      return await deps.database.transaction(async tx => {
        const previous = await replay(tx, input, operation); if (previous) return previous;
        await guardMutation(tx, ctx);
        let row: PlanRecord;
        if ('recipeId' in input) {
          const source = await readRecipe(tx, ctx.familyId, input.recipeId);
          row = planRecord({ _id: id, familyId: ctx.familyId, createdBy: ctx.uid, recipeId: source._id, titleSnapshot: source.title,
            date: input.date, meal: input.meal, targetServings: input.targetServings, version: 1, createdAt: timestamp, updatedAt: timestamp });
          await tx.insert('meal_plans', id, row);
        } else {
          const current = await readPlan(tx, ctx.familyId, id);
          if (current.version !== input.version) throw new AppError('CONFLICT');
          if (!('date' in input)) {
            await tx.remove('meal_plans', id); const result = { done: true } as const;
            await saveReceipt(tx, input, operation, result); return result;
          }
          row = { ...current, date: input.date, meal: input.meal, targetServings: input.targetServings, version: current.version + 1, updatedAt: timestamp };
          await tx.replace('meal_plans', id, row);
        }
        const result = await planView(tx, row); await saveReceipt(tx, input, operation, result); return result;
      });
    } catch (error) {
      if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
      await deps.revalidateIdentity();
      const recovered = await deps.database.transaction(tx => replay(tx, input, operation));
      if (!recovered) throw new AppError('UNAVAILABLE');
      return recovered;
    }
  }
  async function get(raw: unknown): Promise<PlanEntry> {
    const id = planId(raw); await prepare('planning:get', false);
    return deps.database.transaction(async tx => { await confirm(tx); return planView(tx, await readPlan(tx, ctx.familyId, id)); });
  }
  async function list(raw: unknown): Promise<Page<PlanEntry>> {
    const input = listInput(raw); const { from, to, limit } = input;
    const scope = hash(['plan-list-v1', ctx.uid, ctx.familyId, ctx.generation, from, to]);
    let after: PlanCursor | undefined;
    if (input.cursor !== undefined) {
      try {
        const decoded = Buffer.from(input.cursor, 'base64url');
        if (decoded.toString('base64url') !== input.cursor) throw new Error();
        const value = exact(JSON.parse(decoded.toString('utf8')), ['scope', 'date', 'createdAt', 'id']);
        const date = parseLocalDate(value.date);
        if (value.scope !== scope || date < from || date > to || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new Error();
        after = { date, createdAt: value.createdAt, id: planId(value.id) };
      } catch { throw new AppError('INVALID_INPUT'); }
    }
    await prepare('planning:list', false);
    const rows = (await deps.reads.list(ctx.familyId, from, to, limit, after)).map(planCandidate);
    if (rows.length > limit + 1 || rows.some((row, index) => {
      const before = index ? position(rows[index - 1]) : after;
      return row.familyId !== ctx.familyId || row.date < from || row.date > to || (before && comparePosition(position(row), before) <= 0);
    })) throw new AppError('UNAVAILABLE');
    const selected = rows.slice(0, limit);
    const items = await deps.database.transaction(async tx => {
      await confirm(tx); const result: PlanEntry[] = [];
      for (const candidate of selected) {
        let row: PlanRecord;
        try { row = await readPlan(tx, ctx.familyId, candidate._id); }
        catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') continue; throw error; }
        if (row.createdAt !== candidate.createdAt) throw new AppError('UNAVAILABLE');
        if (row.date >= from && row.date <= to) result.push(await planView(tx, row));
      }
      return result;
    });
    const last = selected.at(-1);
    // Advance by examined query positions, including candidates moved or removed during hydration.
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ scope, ...position(last) })).toString('base64url') : null };
  }
  async function finish<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action(); await deps.revalidateIdentity(); await deps.database.transaction(confirm); return result;
    } catch (error) {
      if (error instanceof DatabaseFault && error.kind === 'conflict') throw new AppError('CONFLICT');
      throw safeError(error);
    }
  }
  return {
    add(input) { return finish(async () => await write(input, 'add') as PlanEntry); },
    update(input) { return finish(async () => await write(input, 'update') as PlanEntry); },
    remove(input) { return finish(async () => { await write(input, 'remove'); }); },
    get(id) { return finish(() => get(id)); },
    list(input) { return finish(() => list(input)); },
  };
}
