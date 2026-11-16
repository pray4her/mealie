import { createHash } from 'node:crypto';
import type { FamilyContext, ShoppingAck, ShoppingApi, ShoppingIntent, ShoppingItem, ShoppingList, Page } from 'home-contracts';
import { AppError, consumeRequestLimit, DatabaseFault, safeError } from 'home-kernel';
import type { ContentPort, DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { exact, id, intent, pageInput } from './validation';
import { compare, itemRecord, itemView, listRecord, listView, position, readItem, readList } from './repository';
import type { ItemRecord, ListRecord, Position, ShoppingReads } from './repository';
export { createShoppingReads } from './repository';
export type { ShoppingReads, ShoppingReadPlatform, ListRecord, ItemRecord } from './repository';

export interface ShoppingDeps { database: DatabasePort; reads: ShoppingReads; content: ContentPort; now(): number; newId(): string; revalidateIdentity(): Promise<void> }
type Receipt = { _id: string; uid: string; familyId: string; generation: string; operation: string; requestId: string; payloadHash: string; result: ShoppingAck | { error: 'INVALID_INPUT' }; createdAt: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createShoppingService(deps: ShoppingDeps, ctx: FamilyContext): ShoppingApi {
  async function confirm(tx: TransactionPort) {
    const current = await readFamily(tx, ctx.uid);
    if (!current) throw new AppError('FAMILY_REQUIRED');
    if (current.familyId !== ctx.familyId || current.generation !== ctx.generation || current.role !== ctx.role) throw new AppError('CONFLICT');
  }
  async function prepare(operation: string, write = false, check = false) {
    await deps.database.transaction(confirm);
    await consumeRequestLimit(deps.database, { subject: 'uid:' + ctx.uid, operation, now: deps.now(), max: check ? 120 : write ? 10 : 60 });
    await consumeRequestLimit(deps.database, { subject: 'family:' + ctx.familyId, operation, now: deps.now(), max: check ? 600 : write ? 60 : 300 });
  }
  const operation = (command: ShoppingIntent) => 'shopping-' + command.kind + '-v1';
  const receiptId = (command: ShoppingIntent) => hash(['shopping-v1', ctx.uid, ctx.familyId, ctx.generation, operation(command), command.input.requestId]);
  async function replay(tx: TransactionPort, command: ShoppingIntent): Promise<ShoppingAck | null> {
    await confirm(tx); const rid = receiptId(command); const row = await tx.get<Receipt>('mutation_receipts', rid);
    if (!row) return null;
    if (row._id !== rid || row.uid !== ctx.uid || row.familyId !== ctx.familyId || row.generation !== ctx.generation || row.operation !== operation(command)
      || row.requestId !== command.input.requestId || row.payloadHash !== hash(command.input)) throw new AppError('CONFLICT');
    if (row.result && 'error' in row.result) {
      if (row.result.error !== 'INVALID_INPUT' || Object.keys(row.result).length !== 1) throw new AppError('UNAVAILABLE');
      throw new AppError('INVALID_INPUT');
    }
    try {
      const result = exact(row.result, ['id']); const ack = { id: id(result.id) };
      if ('id' in command.input && ack.id !== command.input.id) throw new Error(); return ack;
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  async function saveReceipt(tx: TransactionPort, command: ShoppingIntent, result: Receipt['result']) {
    const row: Receipt = { _id: receiptId(command), uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation,
      operation: operation(command), requestId: command.input.requestId, payloadHash: hash(command.input), result, createdAt: deps.now() };
    await tx.insert('mutation_receipts', row._id, row);
  }
  async function target(tx: TransactionPort, command: ShoppingIntent) {
    const input = command.input;
    const row = 'listId' in input ? ('id' in input ? await readItem(tx, ctx.familyId, input.listId, input.id) : await readList(tx, ctx.familyId, input.listId))
      : 'id' in input ? await readList(tx, ctx.familyId, input.id) : null;
    if ('version' in input && row?.version !== input.version) throw new AppError('CONFLICT'); return row;
  }
  async function write(kind: ShoppingIntent['kind'], raw: unknown): Promise<ShoppingAck> {
    const command = intent(kind, raw); const input = command.input;
    if (input.familyId !== ctx.familyId || input.generation !== ctx.generation) throw new AppError('CONFLICT');
    await prepare(operation(command), true, kind === 'setChecked');
    const existing = await deps.database.transaction(async tx => { const ack = await replay(tx, command); if (!ack) await target(tx, command); return ack; });
    if (existing) return existing;
    const audit = 'item' in input ? Object.values(input.item).filter(value => typeof value === 'string').join('\n') : 'name' in input ? input.name : null;
    const verdict = audit === null ? 'allowed' : await deps.content.checkText(audit);
    if (verdict !== 'allowed' && verdict !== 'rejected') throw new AppError('UNAVAILABLE');
    await deps.revalidateIdentity();
    const recordId = 'id' in input ? input.id : id(deps.newId()); const timestamp = deps.now();
    try {
      const result = await deps.database.transaction(async tx => {
        const previous = await replay(tx, command); if (previous) return previous;
        await guardMutation(tx, ctx); const current = await target(tx, command);
        if (verdict === 'rejected') { await saveReceipt(tx, command, { error: 'INVALID_INPUT' }); return null; }
        const base = { _id: recordId, familyId: ctx.familyId, createdBy: ctx.uid, version: 1, createdAt: timestamp, updatedAt: timestamp };
        switch (command.kind) {
          case 'createList': await tx.insert('shopping_lists', recordId, listRecord({ ...base, name: command.input.name, status: 'active' })); break;
          case 'renameList': case 'removeList': {
            const row = current as ListRecord;
            await tx.replace('shopping_lists', recordId, listRecord({ ...row, version: row.version + 1, updatedAt: timestamp,
              ...(command.kind === 'renameList' ? { name: command.input.name } : { status: 'deleted' }) })); break;
          }
          case 'addItem': await tx.insert('shopping_items', recordId, itemRecord({ ...base, ...command.input.item, listId: command.input.listId, checked: false })); break;
          case 'removeItem': await tx.remove('shopping_items', recordId); break;
          case 'updateItem': case 'setChecked': {
            const row = current as ItemRecord;
            await tx.replace('shopping_items', recordId, itemRecord({ ...row, version: row.version + 1, updatedAt: timestamp,
              ...(command.kind === 'updateItem' ? command.input.item : { checked: command.input.checked }) })); break;
          }
        }
        const ack = { id: recordId }; await saveReceipt(tx, command, ack); return ack;
      });
      if (!result) throw new AppError('INVALID_INPUT'); return result;
    } catch (error) {
      if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
      await deps.revalidateIdentity(); const recovered = await deps.database.transaction(tx => replay(tx, command));
      if (!recovered) throw new AppError('UNAVAILABLE'); return recovered;
    }
  }
  async function list(raw: unknown, items: boolean): Promise<Page<ShoppingList | ShoppingItem>> {
    const query = pageInput(raw, items); const { listId, limit } = query;
    const scope = hash(['shopping-page-v1', ctx.uid, ctx.familyId, ctx.generation, listId ?? null]); let after: Position | undefined;
    if (query.cursor) {
      try {
        const decoded = Buffer.from(query.cursor, 'base64url'); if (decoded.toString('base64url') !== query.cursor) throw new Error();
        const cursor = exact(JSON.parse(decoded.toString('utf8')), ['scope', 'createdAt', 'id']);
        if (cursor.scope !== scope || typeof cursor.createdAt !== 'number' || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0) throw new Error();
        after = { id: id(cursor.id), createdAt: cursor.createdAt };
      } catch { throw new AppError('INVALID_INPUT'); }
    }
    await prepare(items ? 'shopping:listItems' : 'shopping:listLists');
    if (listId) await deps.database.transaction(tx => readList(tx, ctx.familyId, listId));
    const rows = (await deps.reads.list(ctx.familyId, listId, limit, after)).map(row => items ? itemRecord(row) : listRecord(row));
    if (rows.length > limit + 1 || rows.some((row, i) => row.familyId !== ctx.familyId || ('listId' in row ? row.listId !== listId : row.status !== 'active')
      || (i || after ? compare(position(row), i ? position(rows[i - 1]) : after!) <= 0 : false))) throw new AppError('UNAVAILABLE');
    const selected = rows.slice(0, limit);
    const result = await deps.database.transaction(async tx => {
      await confirm(tx); if (listId) await readList(tx, ctx.familyId, listId);
      const values: (ShoppingList | ShoppingItem)[] = [];
      for (const candidate of selected) {
        try {
          const row = listId ? await readItem(tx, ctx.familyId, listId, candidate._id) : await readList(tx, ctx.familyId, candidate._id);
          if (row.createdAt !== candidate.createdAt) throw new AppError('UNAVAILABLE');
          values.push('listId' in row ? itemView(row) : listView(row));
        } catch (error) { if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error; }
      }
      return values;
    });
    const last = selected.at(-1);
    return { items: result, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ scope, ...position(last) })).toString('base64url') : null };
  }
  async function finish<T>(action: () => Promise<T>, parent?: string): Promise<T> {
    try {
      const result = await action(); await deps.revalidateIdentity();
      await deps.database.transaction(async tx => { await confirm(tx); if (parent) await readList(tx, ctx.familyId, parent); }); return result;
    } catch (error) { if (error instanceof DatabaseFault && error.kind === 'conflict') throw new AppError('CONFLICT'); throw safeError(error); }
  }
  return {
    listLists: input => finish(() => list(input, false) as Promise<Page<ShoppingList>>),
    listItems: input => finish(() => list(input, true) as Promise<Page<ShoppingItem>>, input?.listId),
    getList: raw => finish(async () => { const listId = id(raw); await prepare('shopping:getList'); return deps.database.transaction(async tx => { await confirm(tx); return listView(await readList(tx, ctx.familyId, listId)); }); }),
    getItem: raw => finish(async () => { const row = exact(raw, ['listId', 'id']); const listId = id(row.listId); const itemId = id(row.id); await prepare('shopping:getItem');
      return deps.database.transaction(async tx => { await confirm(tx); return itemView(await readItem(tx, ctx.familyId, listId, itemId)); }); }, raw?.listId),
    createList: input => finish(() => write('createList', input)), renameList: input => finish(() => write('renameList', input)), removeList: input => finish(() => write('removeList', input)),
    addItem: input => finish(() => write('addItem', input), input?.listId), updateItem: input => finish(() => write('updateItem', input), input?.listId),
    removeItem: input => finish(() => write('removeItem', input), input?.listId), setChecked: input => finish(() => write('setChecked', input), input?.listId),
  };
}
