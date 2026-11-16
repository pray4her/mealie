import { readonly, ref, watch } from 'vue';
import type { MembershipMutation, ShoppingAck, ShoppingApi, ShoppingIntent, ShoppingItem, ShoppingList } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { id, intent, parseIntent, parseView } from './validation';

type Kind = ShoppingIntent['kind'];
export type ShoppingDraft<K extends Kind> = Omit<Extract<ShoppingIntent, { kind: K }>['input'], keyof MembershipMutation>;
export type ShoppingConfirmation = ShoppingAck & { requestId: string; kind: Kind };
type Scope = { uid: string; familyId: string; generation: string };
export function entityKey(command: ShoppingIntent): string {
  const input = command.input;
  return 'listId' in input ? 'item:' + input.listId + ':' + ('id' in input ? input.id : 'new') : 'list:' + ('id' in input ? input.id : 'new');
}
export function createShoppingController({ api, auth, family, storage, newRequestId }: {
  api: ShoppingApi; auth: AuthController; family: ReturnType<typeof createFamilyController>; storage: SessionStorage; newRequestId(): Promise<string>;
}) {
  const lists = ref<ShoppingList[]>([]); const items = ref<ShoppingItem[]>([]); const selectedId = ref<string | null>(null); const selected = ref<ShoppingList | null>(null);
  const listsCursor = ref<string | null>(null); const itemsCursor = ref<string | null>(null); const pending = ref<ShoppingIntent[]>([]);
  const busy = ref<Record<string, boolean>>({}); const confirmed = ref<ShoppingConfirmation | null>(null); const readError = ref<ReturnType<typeof errorCode> | null>(null);
  const draftScope = ref<string | null>(null); const settled = new Set<string>();
  let scope: Scope | null = null; let lastUid = auth.identity.value?.uid; let epoch = 0; let visible = true; let disposed = false; let listRevision = 0; let itemRevision = 0; let selectionRevision = 0;
  const flights = new Map<string, { fingerprint: string; promise: Promise<ShoppingConfirmation> }>();
  const key = (uid: string) => 'home.shopping.pending.v1:' + encodeURIComponent(uid);
  function conceal() { epoch++; listRevision++; itemRevision++; selectionRevision++; lists.value = []; items.value = []; selected.value = null; listsCursor.value = null; itemsCursor.value = null; pending.value = []; busy.value = {}; readError.value = null; flights.clear(); }
  function forget() { conceal(); selectedId.value = null; confirmed.value = null; settled.clear(); draftScope.value = null; scope = null; if (lastUid) { try { storage.remove(key(lastUid)); } catch { /* Old scope is never displayed after failed cleanup. */ } } }
  const stop = watch([auth.phase, () => auth.identity.value?.uid, family.phase, family.view], ([phase, uid, familyPhase, view]) => {
    if (phase === 'anonymous' || phase === 'signing-out' || uid && lastUid && uid !== lastUid) forget();
    else if (phase !== 'authenticated' || familyPhase !== 'ready') conceal();
    if (uid) lastUid = uid;
    if (phase === 'authenticated' && familyPhase === 'ready') {
      if (!view) { forget(); return; }
      if (view.uid !== uid) { conceal(); return; }
      if (scope && (scope.uid !== uid || scope.familyId !== view.familyId || scope.generation !== view.generation)) forget();
      scope = { uid: view.uid, familyId: view.familyId, generation: view.generation }; draftScope.value = JSON.stringify(scope);
    }
  }, { immediate: true, flush: 'sync' });
  function current(hidden = false) {
    const view = family.view.value;
    if (disposed || !hidden && !visible || auth.phase.value !== 'authenticated' || family.phase.value !== 'ready' || !view || view.uid !== auth.identity.value?.uid) throw new AppError('FAMILY_REQUIRED');
    return { uid: view.uid, familyId: view.familyId, generation: view.generation, epoch };
  }
  const active = (ctx: ReturnType<typeof current>) => !disposed && visible && ctx.epoch === epoch && auth.phase.value === 'authenticated' && auth.identity.value?.uid === ctx.uid
    && family.phase.value === 'ready' && family.view.value?.familyId === ctx.familyId && family.view.value.generation === ctx.generation;
  async function reject(error: unknown) {
    if (errorCode(error) === 'AUTH_REQUIRED') { forget(); await auth.signOut().catch(() => {}); }
    else if (['FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) { forget(); family.clear(); }
  }
  function saved(ctx: Scope): ShoppingIntent[] {
    try {
      const value = storage.get(key(ctx.uid)); if (value === undefined || value === null || value === '') return [];
      if (!Array.isArray(value)) throw new Error();
      const commands = value.map(parseIntent);
      if (commands.some(row => row.input.familyId !== ctx.familyId || row.input.generation !== ctx.generation)) { storage.remove(key(ctx.uid)); return []; }
      if (new Set(commands.map(row => row.input.requestId)).size !== commands.length || new Set(commands.map(entityKey)).size !== commands.length) throw new Error();
      return commands.filter(row => !settled.has(row.input.requestId));
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  function restore() { const ctx = current(); pending.value = saved(ctx); return pending.value; }
  function persist(ctx: Scope, commands: ShoppingIntent[]) {
    try { if (commands.length) storage.set(key(ctx.uid), commands); else storage.remove(key(ctx.uid)); } catch { throw new AppError('UNAVAILABLE'); }
  }
  function complete(ctx: Scope, requestId: string) {
    settled.add(requestId); pending.value = pending.value.filter(row => row.input.requestId !== requestId);
    try { persist(ctx, saved(ctx)); } catch { /* An in-memory settlement prevents a duplicate new operation on stale storage. */ }
  }
  function checkList(value: unknown, ctx: Scope) { const row = parseView(value, false); if (row.familyId !== ctx.familyId) throw new AppError('UNAVAILABLE'); return row; }
  function checkItem(value: unknown, ctx: Scope, listId: string) { const row = parseView(value, true); if (row.familyId !== ctx.familyId || row.listId !== listId) throw new AppError('UNAVAILABLE'); return row; }
  async function listLists(more = false) {
    const ctx = current(); const revision = more ? listRevision : ++listRevision; const cursor = more ? listsCursor.value : null; if (more && !cursor) return;
    try {
      const result = await api.listLists({ limit: 20, ...(cursor ? { cursor } : {}) }); if (!active(ctx) || revision !== listRevision) return;
      const values = new Map((more ? lists.value : []).map(row => [row.id, row])); result.items.forEach(value => { const row = checkList(value, ctx); values.set(row.id, row); });
      lists.value = [...values.values()]; listsCursor.value = result.nextCursor; readError.value = null;
    } catch (error) { if (active(ctx) && revision === listRevision) { readError.value = errorCode(error); await reject(error); throw new AppError(errorCode(error)); } }
  }
  async function getList(listId: string) { const ctx = current(); const row = checkList(await api.getList(id(listId)), ctx); return active(ctx) ? row : null; }
  async function getItem(listId: string, itemId: string) { const ctx = current(); const row = checkItem(await api.getItem({ listId: id(listId), id: id(itemId) }), ctx, listId); return active(ctx) ? row : null; }
  async function listItems(more = false) {
    const ctx = current(); const listId = selectedId.value; if (!listId) return;
    const revision = more ? itemRevision : ++itemRevision; const cursor = more ? itemsCursor.value : null; if (more && !cursor) return;
    try {
      const result = await api.listItems({ listId, limit: 20, ...(cursor ? { cursor } : {}) }); if (!active(ctx) || revision !== itemRevision || listId !== selectedId.value) return;
      const values = new Map((more ? items.value : []).map(row => [row.id, row])); result.items.forEach(value => { const row = checkItem(value, ctx, listId); values.set(row.id, row); });
      items.value = [...values.values()]; itemsCursor.value = result.nextCursor; readError.value = null;
    } catch (error) {
      if (!active(ctx) || revision !== itemRevision) return;
      if (errorCode(error) === 'NOT_FOUND') { selectedId.value = null; selected.value = null; items.value = []; itemsCursor.value = null; }
      readError.value = errorCode(error); await reject(error); throw new AppError(errorCode(error));
    }
  }
  async function select(listId: string) {
    const ctx = current(); id(listId); const revision = ++selectionRevision; itemRevision++; selectedId.value = listId; selected.value = null; items.value = []; itemsCursor.value = null;
    try { const row = await getList(listId); if (!active(ctx) || revision !== selectionRevision || !row) return; selected.value = row; await listItems(); }
    catch (error) { if (active(ctx) && revision === selectionRevision && selectedId.value === listId) { if (errorCode(error) === 'NOT_FOUND') { selectedId.value = null; selected.value = null; } await reject(error); throw error; } }
  }
  async function refresh() {
    await listLists(); if (selectedId.value) await select(selectedId.value); else if (lists.value[0]) await select(lists.value[0].id);
  }
  function execute(ctx: ReturnType<typeof current>, entity: string, fingerprint: string, prepare: () => Promise<ShoppingIntent>) {
    busy.value = { ...busy.value, [entity]: true };
    const promise = Promise.resolve().then(async () => {
      const command = await prepare(); if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      const commands = saved(ctx).filter(row => row.input.requestId !== command.input.requestId); commands.push(command);
      persist(ctx, commands); pending.value = commands;
      let ack: ShoppingAck;
      try { ack = await (api[command.kind] as (input: ShoppingIntent['input']) => Promise<ShoppingAck>)(command.input); id(ack.id); if ('id' in command.input && ack.id !== command.input.id) throw new AppError('UNAVAILABLE'); }
      catch (error) {
        if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
        if (['CONFLICT', 'INVALID_INPUT', 'NOT_FOUND'].includes(errorCode(error))) complete(ctx, command.input.requestId);
        await reject(error); throw new AppError(errorCode(error));
      }
      if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      complete(ctx, command.input.requestId); const result = { ...ack, requestId: command.input.requestId, kind: command.kind }; confirmed.value = result;
      if (command.kind === 'removeList' && selectedId.value === ack.id) { selectedId.value = null; selected.value = null; items.value = []; itemsCursor.value = null; }
      // Reading current data cannot turn a definitive acknowledgement into an unknown write.
      try { await refresh(); } catch (error) { if (active(ctx)) readError.value = errorCode(error); }
      return result;
    }).finally(() => { if (flights.get(entity)?.promise === promise) { flights.delete(entity); const next = { ...busy.value }; delete next[entity]; busy.value = next; } });
    flights.set(entity, { fingerprint, promise }); return promise;
  }
  function write<K extends Kind>(kind: K, draft: ShoppingDraft<K>): Promise<ShoppingConfirmation> {
    const ctx = current(); const command = intent(kind, { ...draft, familyId: ctx.familyId, generation: ctx.generation, requestId: 'validation-only-01' });
    const entity = entityKey(command); const fingerprint = JSON.stringify(command); const flight = flights.get(entity);
    if (flight) { if (flight.fingerprint === fingerprint) return flight.promise; return Promise.reject(new AppError('CONFLICT')); }
    if (restore().some(row => entityKey(row) === entity)) return Promise.reject(new AppError('CONFLICT'));
    return execute(ctx, entity, fingerprint, async () => intent(kind, { ...command.input, requestId: await newRequestId() }));
  }
  function retry(requestId: string) {
    const ctx = current(); const command = restore().find(row => row.input.requestId === requestId); if (!command) return Promise.reject(new AppError('INVALID_INPUT'));
    const entity = entityKey(command); const flight = flights.get(entity); return flight?.promise ?? execute(ctx, entity, 'retry:' + requestId, async () => command);
  }
  return { lists: readonly(lists), items: readonly(items), selectedId: readonly(selectedId), selected: readonly(selected), listsCursor: readonly(listsCursor), itemsCursor: readonly(itemsCursor),
    pending: readonly(pending), busy: readonly(busy), confirmed: readonly(confirmed), readError: readonly(readError), draftScope: readonly(draftScope),
    listLists, listItems, getList, getItem, select, refresh, write, retry, restore,
    activate() { current(true); visible = true; }, clear() { visible = false; conceal(); }, dispose() { disposed = true; stop(); conceal(); scope = null; draftScope.value = null; confirmed.value = null; settled.clear(); },
  };
}
