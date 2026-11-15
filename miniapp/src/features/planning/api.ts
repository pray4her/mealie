import type { PlanningApi } from 'home-contracts';
import type { Invoke } from '../family/api';
import type { SessionBoundary } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, validId } from '../recipes/validation';
import { parsePlanEntry, parsePlanIntent, parsePlanList } from './validation';

export function createPlanningApi({ invoke, boundary }: { invoke: Invoke; boundary: SessionBoundary }): PlanningApi {
  async function call(method: string, input: unknown): Promise<unknown> {
    try { return await invoke('planning-co', method, input); }
    catch (error) {
      if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {});
      throw new AppError(errorCode(error));
    }
  }
  async function write(kind: 'add' | 'update', input: unknown) {
    const intent = parsePlanIntent({ kind, input }); const result = parsePlanEntry(await call(kind, intent.input));
    if (result.familyId !== intent.input.familyId || (intent.kind === 'add' ? result.recipeId !== intent.input.recipeId : result.id !== intent.input.id)) throw new AppError('UNAVAILABLE');
    // Receipts may be historical. Do not infer the current version or source availability from them.
    return result;
  }
  return {
    add: input => write('add', input), update: input => write('update', input),
    async remove(input) { const intent = parsePlanIntent({ kind: 'remove', input }); if (await call('remove', intent.input) !== null) throw new AppError('UNAVAILABLE'); },
    async get(id) { const result = parsePlanEntry(await call('get', validId(id))); if (result.id !== id) throw new AppError('UNAVAILABLE'); return result; },
    async list(input) {
      const query = parsePlanList(input); const response = await call('list', query);
      try {
        const row = object(response, ['items', 'nextCursor']);
        if (!Array.isArray(row.items) || row.items.length > query.limit || row.nextCursor !== null && (typeof row.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.nextCursor))) throw new Error();
        const items = row.items.map(parsePlanEntry);
        if (items.some(item => item.familyId !== items[0].familyId || item.date < query.from || item.date > query.to)) throw new Error();
        return { items, nextCursor: row.nextCursor as string | null };
      } catch { throw new AppError('UNAVAILABLE'); }
    },
  };
}
