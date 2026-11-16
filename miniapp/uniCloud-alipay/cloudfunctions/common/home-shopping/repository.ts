import type { ShoppingList, ShoppingItem } from 'home-contracts';
import { AppError } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import { exact, id, itemFields, text, version } from './validation';

export type ListRecord = Omit<ShoppingList, 'id'> & { _id: string; status: 'active' | 'deleted' };
export type ItemRecord = Omit<ShoppingItem, 'id'> & { _id: string };
export type Position = { createdAt: number; id: string };
export interface ShoppingReads { list(familyId: string, listId: string | undefined, limit: number, after?: Position): Promise<unknown[]> }
interface Query { where(value: unknown): Query; orderBy(field: string, order: 'asc'): Query; limit(count: number): Query; get(): Promise<unknown> }
export interface ShoppingReadPlatform {
  collection(name: 'shopping_lists' | 'shopping_items'): Query;
  command: { gt(value: unknown): unknown; and(values: unknown[]): unknown; or(values: unknown[]): unknown };
}
export function createShoppingReads(platform: ShoppingReadPlatform): ShoppingReads {
  return { async list(familyId, listId, limit, after) {
    const cmd = platform.command; const filter = { familyId, ...(listId ? { listId } : { status: 'active' }) };
    const where = after ? cmd.and([filter, cmd.or([{ createdAt: cmd.gt(after.createdAt) }, { createdAt: after.createdAt, _id: cmd.gt(after.id) }])]) : filter;
    const result = await platform.collection(listId ? 'shopping_items' : 'shopping_lists').where(where).orderBy('createdAt', 'asc').orderBy('_id', 'asc').limit(limit + 1).get();
    if (!result || typeof result !== 'object' || 'errCode' in result && result.errCode !== 0 || !('data' in result) || !Array.isArray(result.data)) throw new AppError('UNAVAILABLE'); return result.data;
  } };
}
function base(row: Record<string, unknown>) {
  for (const field of ['createdAt', 'updatedAt']) if (typeof row[field] !== 'number' || !Number.isSafeInteger(row[field]) || (row[field] as number) < 0) throw new AppError('INVALID_INPUT');
  if ((row.updatedAt as number) < (row.createdAt as number)) throw new AppError('INVALID_INPUT');
  return { _id: id(row._id), familyId: text(row.familyId, 128), createdBy: row.createdBy === null ? null : text(row.createdBy, 128),
    version: version(row.version), createdAt: row.createdAt as number, updatedAt: row.updatedAt as number };
}
export function listRecord(value: unknown): ListRecord {
  try {
    const row = exact(value, ['_id', 'familyId', 'name', 'status', 'createdBy', 'version', 'createdAt', 'updatedAt']);
    if (row.status !== 'active' && row.status !== 'deleted') throw new Error();
    return { ...base(row), name: text(row.name, 40), status: row.status };
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function itemRecord(value: unknown): ItemRecord {
  try {
    const row = exact(value, ['_id', 'familyId', 'listId', 'raw', 'name', 'quantity', 'unit', 'note', 'checked', 'createdBy', 'version', 'createdAt', 'updatedAt']);
    if (typeof row.checked !== 'boolean') throw new Error();
    return { ...base(row), ...itemFields(Object.fromEntries(['raw', 'name', 'quantity', 'unit', 'note'].map(key => [key, row[key]]))), listId: id(row.listId), checked: row.checked };
  } catch { throw new AppError('UNAVAILABLE'); }
}
export async function readList(tx: TransactionPort, familyId: string, listId: string): Promise<ListRecord> {
  const raw = await tx.get<ListRecord>('shopping_lists', listId);
  if (!raw || raw.familyId !== familyId || raw.status !== 'active') throw new AppError('NOT_FOUND'); return listRecord(raw);
}
export async function readItem(tx: TransactionPort, familyId: string, listId: string, itemId: string): Promise<ItemRecord> {
  await readList(tx, familyId, listId);
  const raw = await tx.get<ItemRecord>('shopping_items', itemId);
  if (!raw || raw.familyId !== familyId || raw.listId !== listId) throw new AppError('NOT_FOUND'); return itemRecord(raw);
}
export function listView(row: ListRecord): ShoppingList { const { _id, status: _status, ...rest } = row; return { id: _id, ...rest }; }
export function itemView(row: ItemRecord): ShoppingItem { const { _id, ...rest } = row; return { id: _id, ...rest }; }
export const position = (row: ListRecord | ItemRecord): Position => ({ createdAt: row.createdAt, id: row._id });
export const compare = (a: Position, b: Position) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
