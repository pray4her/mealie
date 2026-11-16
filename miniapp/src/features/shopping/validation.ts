import type { ShoppingIntent, ShoppingItemFields, ShoppingList, ShoppingItem } from 'home-contracts';
import { AppError } from '../../shared/errors';

export function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) throw new AppError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, preserve = false): string {
  // eslint-disable-next-line no-control-regex -- Explicit ranges match existing Android-compatible validators.
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\u0000-\u001F\u007F-\u009F]/.test(preserve ? value.replace(/[\r\n\t]/g, '') : value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new AppError('INVALID_INPUT');
  return preserve ? value : value.trim();
}
export const shoppingKinds = ['createList', 'renameList', 'removeList', 'addItem', 'updateItem', 'removeItem', 'setChecked'] as const;
export function parseIntent(value: unknown): ShoppingIntent {
  const row = exact(value, ['kind', 'input']);
  if (!shoppingKinds.includes(row.kind as ShoppingIntent['kind'])) throw new AppError('INVALID_INPUT');
  return intent(row.kind as ShoppingIntent['kind'], row.input);
}
export function parseView(value: unknown, item: false): ShoppingList;
export function parseView(value: unknown, item: true): ShoppingItem;
export function parseView(value: unknown, item: boolean): ShoppingList | ShoppingItem {
  try {
    const row = exact(value, ['id', 'familyId', 'createdBy', 'version', 'createdAt', 'updatedAt', ...(item ? ['listId', 'raw', 'name', 'quantity', 'unit', 'note', 'checked'] : ['name'])]);
    for (const field of ['createdAt', 'updatedAt']) if (typeof row[field] !== 'number' || !Number.isSafeInteger(row[field]) || (row[field] as number) < 0) throw new Error();
    if ((row.updatedAt as number) < (row.createdAt as number)) throw new Error();
    const base = { id: id(row.id), familyId: text(row.familyId, 128), createdBy: row.createdBy === null ? null : text(row.createdBy, 128),
      version: version(row.version), createdAt: row.createdAt as number, updatedAt: row.updatedAt as number };
    if (!item) return { ...base, name: text(row.name, 40) };
    if (typeof row.checked !== 'boolean') throw new Error();
    return { ...base, listId: id(row.listId), checked: row.checked, ...itemFields(Object.fromEntries(['raw', 'name', 'quantity', 'unit', 'note'].map(key => [key, row[key]]))) };
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new AppError('INVALID_INPUT'); return value;
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw new AppError('INVALID_INPUT'); return value;
}
export function itemFields(value: unknown): ShoppingItemFields {
  const row = exact(value, ['raw', 'name', 'quantity', 'unit', 'note']);
  if (row.quantity !== null && (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1_000_000)) throw new AppError('INVALID_INPUT');
  return { raw: text(row.raw, 500, true), name: row.name === null ? null : text(row.name, 100), quantity: row.quantity as number | null,
    unit: row.unit === null ? null : text(row.unit, 40), note: row.note === null ? null : text(row.note, 500, true) };
}
export function intent(kind: ShoppingIntent['kind'], value: unknown): ShoppingIntent {
  const hasId = !['createList', 'addItem'].includes(kind); const isItem = ['addItem', 'updateItem', 'removeItem', 'setChecked'].includes(kind);
  const row = exact(value, ['requestId', 'familyId', 'generation', ...(hasId ? ['id', 'version'] : []), ...(isItem ? ['listId'] : []),
    ...(['createList', 'renameList'].includes(kind) ? ['name'] : []), ...(['addItem', 'updateItem'].includes(kind) ? ['item'] : []), ...(kind === 'setChecked' ? ['checked'] : [])]);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)) throw new AppError('INVALID_INPUT');
  const base = { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128) };
  const target = hasId ? { id: id(row.id), version: version(row.version) } : {};
  if (kind === 'setChecked' && typeof row.checked !== 'boolean') throw new AppError('INVALID_INPUT');
  return { kind, input: { ...base, ...target, ...(isItem ? { listId: id(row.listId) } : {}),
    ...(['createList', 'renameList'].includes(kind) ? { name: text(row.name, 40) } : {}),
    ...(['addItem', 'updateItem'].includes(kind) ? { item: itemFields(row.item) } : {}), ...(kind === 'setChecked' ? { checked: row.checked } : {}) } } as ShoppingIntent;
}
export function pageInput(value: unknown, items: boolean) {
  const row = exact(value, items ? ['listId'] : [], ['limit', 'cursor']);
  const limit = row.limit === undefined ? 20 : row.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || row.cursor !== undefined && (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor))) throw new AppError('INVALID_INPUT');
  return { limit, cursor: row.cursor as string | undefined, listId: items ? id(row.listId) : undefined };
}
