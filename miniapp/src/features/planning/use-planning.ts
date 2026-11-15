import { readonly, ref, watch } from 'vue';
import type { PlanEntry, PlanFields, PlanningApi, RecipesApi, MediaApi, Recipe } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, parseListInput, validId } from '../recipes/validation';
import { beijingToday, parseLocalDate } from './dates';
import { parsePlanEntry, parsePlanIntent } from './validation';
import type { PlanIntent } from './validation';

export type PlanAddDraft = PlanFields & { recipeId: string };
export type PlanUpdateDraft = PlanFields & { id: string; version: number };
export type PlanRemoveDraft = { id: string; version: number };
export type PlanAcknowledgement = { kind: PlanIntent['kind']; requestId: string; id: string };
type Scope = { uid: string; familyId: string; generation: string };
export function createPlanningController({ api, recipes, media, auth, family, storage, newRequestId, now = Date.now }: {
  api: PlanningApi; recipes: RecipesApi; media: MediaApi; auth: AuthController; family: ReturnType<typeof createFamilyController>;
  storage: SessionStorage; newRequestId(): Promise<string>; now?: () => number;
}) {
  const selectedDate = ref(beijingToday(now())); const items = ref<PlanEntry[]>([]); const entry = ref<PlanEntry | null>(null);
  const nextCursor = ref<string | null>(null); const pending = ref<PlanIntent | null>(null); const confirmed = ref<PlanAcknowledgement | null>(null);
  const readError = ref<ReturnType<typeof errorCode> | null>(null); const writing = ref(false); const draftScope = ref<string | null>(null);
  const searchItems = ref<Recipe[]>([]); const searchCursor = ref<string | null>(null); const searchQuery = ref(''); const selectedRecipe = ref<Recipe | null>(null);
  const coverUrls = ref<Record<string, string>>({});
  let epoch = 0; let visible = true; let disposed = false; let scope: Scope | null = null; let uid = auth.identity.value?.uid;
  let acknowledged: PlanAcknowledgement | null = null;
  let flight: { ctx: Scope & { epoch: number }; fingerprint: string; promise: Promise<PlanAcknowledgement> } | null = null;
  let listRevision = 0; let getRevision = 0; let searchRevision = 0; let selectionRevision = 0; let coverRevision = 0;
  let listFlight: { cursor: string | null; promise: Promise<void> } | null = null;
  let searchFlight: { query: string; cursor: string | null; promise: Promise<void> } | null = null;
  const key = (value: string) => 'home.planning.pending.v1:' + encodeURIComponent(value);
  function resetList() { listRevision++; listFlight = null; items.value = []; nextCursor.value = null; coverRevision++; coverUrls.value = {}; }
  function conceal() {
    epoch++; flight = null; writing.value = false; resetList(); getRevision++; searchRevision++; selectionRevision++; searchFlight = null;
    entry.value = null; pending.value = null; confirmed.value = null; readError.value = null;
    searchItems.value = []; searchCursor.value = null; searchQuery.value = ''; selectedRecipe.value = null;
  }
  function forget() {
    conceal(); acknowledged = null; scope = null; draftScope.value = null; selectedDate.value = beijingToday(now());
    if (uid) { try { storage.remove(key(uid)); } catch { /* Never expose a failed cleanup's old scope. */ } }
  }
  const stop = watch([auth.phase, () => auth.identity.value?.uid, family.phase, family.view], ([phase, currentUid, familyPhase, view]) => {
    if (phase === 'anonymous' || phase === 'signing-out' || phase === 'authenticated' && currentUid && uid && currentUid !== uid) forget();
    else if (phase !== 'authenticated' || !currentUid || familyPhase !== 'ready') conceal();
    if (phase === 'authenticated' && currentUid) uid = currentUid;
    if (phase === 'authenticated' && currentUid && familyPhase === 'ready') {
      if (!view) { forget(); return; }
      if (view.uid !== currentUid) { conceal(); return; }
      if (scope && (scope.uid !== view.uid || scope.familyId !== view.familyId || scope.generation !== view.generation)) forget();
      scope = { uid: view.uid, familyId: view.familyId, generation: view.generation }; draftScope.value = JSON.stringify(scope);
    }
  }, { flush: 'sync', immediate: true });
  function current(allowHidden = false) {
    const view = family.view.value;
    if (disposed || !allowHidden && !visible || auth.phase.value !== 'authenticated' || !auth.identity.value || family.phase.value !== 'ready'
      || !view || view.uid !== auth.identity.value.uid) throw new AppError('FAMILY_REQUIRED');
    return { uid: view.uid, familyId: view.familyId, generation: view.generation, epoch };
  }
  const active = (ctx: ReturnType<typeof current>) => !disposed && visible && ctx.epoch === epoch && auth.phase.value === 'authenticated'
    && auth.identity.value?.uid === ctx.uid && family.phase.value === 'ready' && family.view.value?.uid === ctx.uid
    && family.view.value.familyId === ctx.familyId && family.view.value.generation === ctx.generation;
  async function rejectScope(error: unknown) {
    const code = errorCode(error);
    if (code === 'AUTH_REQUIRED') { forget(); await auth.signOut().catch(() => {}); }
    else if (code === 'FAMILY_REQUIRED' || code === 'FORBIDDEN') { forget(); family.clear(); readError.value = code; }
  }
  function restore(): PlanIntent | null {
    const ctx = current(); pending.value = null;
    try {
      const saved = storage.get(key(ctx.uid)); if (saved === null || saved === undefined || saved === '') return null;
      const intent = parsePlanIntent(saved);
      if (intent.input.familyId !== ctx.familyId || intent.input.generation !== ctx.generation) { storage.remove(key(ctx.uid)); return null; }
      if (acknowledged?.requestId === intent.input.requestId) { storage.remove(key(ctx.uid)); return null; }
      pending.value = intent; return intent;
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  function checked(value: unknown, ctx: Scope, id?: string) {
    const row = parsePlanEntry(value);
    if (row.familyId !== ctx.familyId || id && row.id !== id) throw new AppError('UNAVAILABLE'); return row;
  }
  async function get(id: string): Promise<PlanEntry | null> {
    const ctx = current(); validId(id); const revision = ++getRevision; entry.value = null; readError.value = null;
    coverRevision++; coverUrls.value = {};
    try {
      const result = await api.get(id); if (!active(ctx) || revision !== getRevision) return null;
      entry.value = checked(result, ctx, id); return result;
    } catch (error) {
      if (!active(ctx) || revision !== getRevision) return null;
      readError.value = errorCode(error); await rejectScope(error); throw new AppError(errorCode(error));
    }
  }
  function list(more = false): Promise<void> {
    const ctx = current(); const cursor = more ? nextCursor.value : null;
    if (more && !cursor) return Promise.resolve();
    if (listFlight?.cursor === cursor) return listFlight.promise;
    if (!more) resetList(); const revision = listRevision; const date = selectedDate.value; readError.value = null;
    const promise = Promise.resolve().then(async () => {
      if (!active(ctx) || revision !== listRevision) return;
      try {
        const page = await api.list({ from: date, to: date, limit: 20, ...(cursor ? { cursor } : {}) });
        if (!active(ctx) || revision !== listRevision) return;
        const rows = page.items.map(row => checked(row, ctx));
        if (rows.some(row => row.date !== date)) throw new AppError('UNAVAILABLE');
        const unique = new Map((more ? items.value : []).map(row => [row.id, row]));
        rows.forEach(row => { if (!unique.has(row.id)) unique.set(row.id, row); }); items.value = [...unique.values()]; nextCursor.value = page.nextCursor;
      } catch (error) {
        if (!active(ctx) || revision !== listRevision) return;
        readError.value = errorCode(error); await rejectScope(error); throw new AppError(errorCode(error));
      }
    }).finally(() => { if (listFlight?.promise === promise) listFlight = null; });
    listFlight = { cursor, promise }; return promise;
  }
  async function refreshAcknowledged(ctx: ReturnType<typeof current>, ack: PlanAcknowledgement) {
    resetList(); getRevision++; entry.value = null;
    // Reads cannot turn a definitive acknowledgement into an uncertain write or invite another add.
    let failure: ReturnType<typeof errorCode> | null = null;
    if (ack.kind !== 'remove') { try { await get(ack.id); } catch (error) { failure = errorCode(error); } }
    if (!active(ctx)) return;
    try { await list(); } catch (error) { failure ??= errorCode(error); }
    if (active(ctx)) readError.value = failure;
  }
  function execute(ctx: ReturnType<typeof current>, fingerprint: string, prepare: () => Promise<PlanIntent>): Promise<PlanAcknowledgement> {
    writing.value = true;
    const promise = Promise.resolve().then(async () => {
      const intent = await prepare(); if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      // This is the only persistence point: no draft is saved, and a failed write sends nothing.
      try { storage.set(key(ctx.uid), intent); } catch { throw new AppError('UNAVAILABLE'); }
      pending.value = intent; confirmed.value = null; acknowledged = null;
      let id: string;
      try {
        if (intent.kind === 'remove') { await api.remove(intent.input); id = intent.input.id; }
        else {
          const result = checked(await (intent.kind === 'add' ? api.add(intent.input) : api.update(intent.input)), ctx, intent.kind === 'update' ? intent.input.id : undefined);
          if (intent.kind === 'add' && result.recipeId !== intent.input.recipeId) throw new AppError('UNAVAILABLE'); id = result.id;
        }
      } catch (error) {
        if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
        if (['CONFLICT', 'INVALID_INPUT', 'NOT_FOUND'].includes(errorCode(error))) {
          try { storage.remove(key(ctx.uid)); } catch { /* Keep the durable original blocked until cleanup/retry succeeds. */ }
          pending.value = null;
        }
        await rejectScope(error); throw new AppError(errorCode(error));
      }
      if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      const ack: PlanAcknowledgement = { kind: intent.kind, requestId: intent.input.requestId, id };
      acknowledged = ack; confirmed.value = ack; pending.value = null;
      try { storage.remove(key(ctx.uid)); } catch { /* In-memory acknowledgement still prevents treating this as uncommitted. */ }
      await refreshAcknowledged(ctx, ack); if (!active(ctx)) throw new AppError('FAMILY_REQUIRED'); return ack;
    }).catch(error => { throw new AppError(errorCode(error)); }).finally(() => { if (flight?.promise === promise) { flight = null; writing.value = false; } });
    flight = { ctx, fingerprint, promise }; return promise;
  }
  async function write(kind: PlanIntent['kind'], input: PlanAddDraft | PlanUpdateDraft | PlanRemoveDraft): Promise<PlanAcknowledgement> {
    const ctx = current();
    const row = object(input, [...(kind === 'add' ? ['recipeId'] : ['id', 'version']), ...(kind === 'remove' ? [] : ['date', 'meal', 'targetServings'])]);
    const validated = parsePlanIntent({ kind, input: { ...row, familyId: ctx.familyId, generation: ctx.generation, requestId: 'validation-only-01' } });
    const fingerprint = JSON.stringify(validated);
    if (flight && active(flight.ctx)) { if (flight.fingerprint === fingerprint) return flight.promise; throw new AppError('CONFLICT'); }
    if (restore()) throw new AppError('CONFLICT');
    return execute(ctx, fingerprint, async () => parsePlanIntent({ kind, input: { ...validated.input, requestId: await newRequestId() } }));
  }
  async function retry(): Promise<PlanAcknowledgement> {
    const ctx = current();
    if (flight && active(flight.ctx)) return flight.promise;
    const intent = restore(); if (!intent) throw new AppError('INVALID_INPUT');
    return execute(ctx, 'retry:' + intent.input.requestId, async () => intent);
  }
  function search(query: string, more = false): Promise<void> {
    const ctx = current(); const parsed = parseListInput({ query }); const value = parsed.query!;
    const cursor = more && value === searchQuery.value ? searchCursor.value : null;
    if (more && !cursor) return Promise.resolve();
    if (searchFlight?.query === value && searchFlight.cursor === cursor) return searchFlight.promise;
    if (!more) { searchRevision++; searchItems.value = []; searchCursor.value = null; }
    searchQuery.value = value; const revision = searchRevision;
    const promise = Promise.resolve().then(async () => {
      if (!active(ctx) || revision !== searchRevision) return;
      try {
        const page = await recipes.list({ query: value, limit: 20, ...(cursor ? { cursor } : {}) });
        if (!active(ctx) || revision !== searchRevision) return;
        if (page.items.some(row => row.familyId !== ctx.familyId)) throw new AppError('UNAVAILABLE');
        const unique = new Map((more ? searchItems.value : []).map(row => [row.id, row]));
        page.items.forEach(row => { if (!unique.has(row.id)) unique.set(row.id, row); }); searchItems.value = [...unique.values()]; searchCursor.value = page.nextCursor;
      } catch (error) { if (active(ctx) && revision === searchRevision) { await rejectScope(error); throw new AppError(errorCode(error)); } }
    }).finally(() => { if (searchFlight?.promise === promise) searchFlight = null; });
    searchFlight = { query: value, cursor, promise }; return promise;
  }
  async function selectRecipe(id: string): Promise<Recipe | null> {
    const ctx = current(); validId(id); const revision = ++selectionRevision; selectedRecipe.value = null;
    try {
      const row = await recipes.get(id); if (!active(ctx) || revision !== selectionRevision) return null;
      if (row.familyId !== ctx.familyId || row.id !== id) throw new AppError('UNAVAILABLE'); selectedRecipe.value = row; return row;
    } catch (error) { if (active(ctx) && revision === selectionRevision) { await rejectScope(error); throw new AppError(errorCode(error)); } return null; }
  }
  async function loadCovers(rows: readonly PlanEntry[] = items.value.slice(-20)): Promise<void> {
    const ctx = current(); const revision = ++coverRevision; coverUrls.value = {};
    await Promise.all(rows.slice(0, 20).map(async value => {
      const row = checked(value, ctx); if (!row.sourceAvailable || !row.coverImageId) return;
      try {
        const link = await media.read({ familyId: ctx.familyId, generation: ctx.generation, mediaId: row.coverImageId });
        if (active(ctx) && revision === coverRevision && link.mediaId === row.coverImageId) coverUrls.value = { ...coverUrls.value, [row.id]: link.url };
      } catch (error) {
        if (active(ctx) && revision === coverRevision && ['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) {
          await rejectScope(error); throw new AppError(errorCode(error));
        }
        // An unreadable cover is a text-only card, never a persisted URL or a failed plan read.
      }
    }));
  }
  return {
    selectedDate: readonly(selectedDate), items: readonly(items), entry: readonly(entry), nextCursor: readonly(nextCursor), pending: readonly(pending),
    confirmed: readonly(confirmed), readError: readonly(readError), writing: readonly(writing), draftScope: readonly(draftScope),
    searchItems: readonly(searchItems), searchCursor: readonly(searchCursor), searchQuery: readonly(searchQuery), selectedRecipe: readonly(selectedRecipe), coverUrls: readonly(coverUrls),
    selectDate(date: string) { current(); const value = parseLocalDate(date); if (value !== selectedDate.value) { selectedDate.value = value; resetList(); } },
    list, get, restore, retry, search, selectRecipe, loadCovers,
    add: (input: PlanAddDraft) => write('add', input), update: (input: PlanUpdateDraft) => write('update', input), remove: (input: PlanRemoveDraft) => write('remove', input),
    activate() { current(true); visible = true; confirmed.value = acknowledged; },
    clear() { visible = false; conceal(); },
    dispose() { disposed = true; stop(); conceal(); scope = null; draftScope.value = null; acknowledged = null; },
  };
}
