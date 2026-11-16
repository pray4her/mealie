import type { Page, ShoppingApi, ShoppingIntent, ShoppingItem, ShoppingList } from 'home-contracts';
import type { Invoke } from '../family/api';
import type { SessionBoundary } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { exact, id, intent, pageInput, parseView } from './validation';

export function createShoppingApi({ invoke, boundary }: { invoke: Invoke; boundary: SessionBoundary }): ShoppingApi {
  async function call(method: string, input: unknown) {
    try { return await invoke('shopping-co', method, input); }
    catch (error) { if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {}); throw new AppError(errorCode(error)); }
  }
  async function write(kind: ShoppingIntent['kind'], input: unknown) {
    const command = intent(kind, input); const result = await call(kind, command.input);
    try { const row = exact(result, ['id']); const ack = { id: id(row.id) }; if ('id' in command.input && ack.id !== command.input.id) throw new Error(); return ack; }
    catch { throw new AppError('UNAVAILABLE'); }
  }
  async function list(input: unknown, items: boolean): Promise<Page<ShoppingList | ShoppingItem>> {
    const query = pageInput(input, items);
    const response = await call(items ? 'listItems' : 'listLists', { ...(items ? { listId: query.listId } : {}), limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) });
    try {
      const row = exact(response, ['items', 'nextCursor']);
      if (!Array.isArray(row.items) || row.items.length > query.limit || row.nextCursor !== null && (typeof row.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.nextCursor))) throw new Error();
      const values = row.items.map(value => items ? parseView(value, true) : parseView(value, false));
      if (new Set(values.map(value => value.id)).size !== values.length || values.some(value => value.familyId !== values[0].familyId || 'listId' in value && value.listId !== query.listId)) throw new Error();
      return { items: values, nextCursor: row.nextCursor as string | null };
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  return {
    createList: input => write('createList', input), renameList: input => write('renameList', input), removeList: input => write('removeList', input),
    addItem: input => write('addItem', input), updateItem: input => write('updateItem', input), removeItem: input => write('removeItem', input), setChecked: input => write('setChecked', input),
    listLists: input => list(input, false) as Promise<Page<ShoppingList>>, listItems: input => list(input, true) as Promise<Page<ShoppingItem>>,
    async getList(raw) { const target = id(raw); const row = parseView(await call('getList', target), false); if (row.id !== target) throw new AppError('UNAVAILABLE'); return row; },
    async getItem(raw) { const input = exact(raw, ['listId', 'id']); const listId = id(input.listId); const itemId = id(input.id);
      const row = parseView(await call('getItem', { listId, id: itemId }), true); if (row.id !== itemId || row.listId !== listId) throw new AppError('UNAVAILABLE'); return row; },
  };
}
