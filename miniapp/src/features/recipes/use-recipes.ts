import { readonly, ref, watch } from 'vue';
import type { FamilyView, Recipe, RecipeInput, RecipeMutation, RecipeUpdate, RecipesApi, RecipeFavoriteMutation } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, parseFavoriteMutation, parseInput, parseListInput, parseMutation, validId } from './validation';

export type RecipeIntent = { kind: 'create'; input: RecipeMutation } | { kind: 'update'; input: RecipeUpdate };
export function createRecipesController({ api, auth, family, storage, newRequestId }: {
  api: RecipesApi; auth: AuthController; family: ReturnType<typeof createFamilyController>; storage: SessionStorage; newRequestId(): Promise<string>;
}) {
  const items = ref<Recipe[]>([]); const recipe = ref<Recipe | null>(null); const pending = ref<RecipeIntent | null>(null); const nextCursor = ref<string | null>(null);
  const filters = ref({ query: '', tag: '', favoritesOnly: false }); const pendingFavorite = ref<RecipeFavoriteMutation | null>(null);
  let epoch = 0; let disposed = false; let scope: FamilyView | null = null; let uid = auth.identity.value?.uid;
  let flight: Promise<Recipe> | null = null;
  let listRevision = 0; let listFlight: { revision: number; cursor: string | null; promise: Promise<void> } | null = null;
  let favoriteFlight: { id: string; enabled: boolean; promise: Promise<void> } | null = null;
  const key = (value: string) => 'home.recipes.pending.v1:' + encodeURIComponent(value);
  const favoriteKey = (value: string) => 'home.recipes.favorite.v1:' + encodeURIComponent(value);
  function resetList() { listRevision++; listFlight = null; items.value = []; nextCursor.value = null; }
  function conceal() { epoch++; resetList(); favoriteFlight = null; recipe.value = null; pendingFavorite.value = null; }
  function forget(value?: string) {
    conceal(); pending.value = null; favoriteFlight = null; filters.value = { query: '', tag: '', favoritesOnly: false };
    if (value) for (const name of [key(value), favoriteKey(value)]) { try { storage.remove(name); } catch { /* State remains hidden if storage is unavailable. */ } }
  }
  const stop = watch([auth.phase, () => auth.identity.value?.uid, family.phase, family.view], ([phase, currentUid, familyPhase, view]) => {
    if (phase === 'anonymous' || phase === 'signing-out' || (currentUid && uid && currentUid !== uid)) { forget(uid); scope = null; }
    else if (phase !== 'authenticated' || familyPhase !== 'ready') conceal();
    if (currentUid) uid = currentUid;
    if (phase === 'authenticated' && familyPhase === 'ready') {
      if (!view || (scope && (scope.familyId !== view.familyId || scope.generation !== view.generation))) forget(uid);
      scope = view;
    }
  }, { flush: 'sync' });
  function current() {
    const view = family.view.value;
    if (disposed || auth.phase.value !== 'authenticated' || !auth.identity.value || family.phase.value !== 'ready' || !view || view.uid !== auth.identity.value.uid) throw new AppError('FAMILY_REQUIRED');
    return { uid: view.uid, familyId: view.familyId, generation: view.generation, epoch };
  }
  const active = (started: ReturnType<typeof current>) => !disposed && started.epoch === epoch && auth.phase.value === 'authenticated'
    && auth.identity.value?.uid === started.uid && family.phase.value === 'ready' && family.view.value?.familyId === started.familyId && family.view.value.generation === started.generation;
  function restore() {
    restoreFavorite();
    const ctx = current(); const value = storage.get(key(ctx.uid)); pending.value = null;
    if (value === undefined || value === null || value === '') return null;
    const row = object(value, ['kind', 'input']);
    const intent: RecipeIntent = row.kind === 'create' ? { kind: 'create', input: parseMutation(row.input, false) }
      : row.kind === 'update' ? { kind: 'update', input: parseMutation(row.input, true) } : (() => { throw new AppError('UNAVAILABLE'); })();
    if (intent.input.familyId !== ctx.familyId || intent.input.generation !== ctx.generation) { storage.remove(key(ctx.uid)); return null; }
    pending.value = intent; return intent;
  }
  function restoreFavorite() {
    const ctx = current(); pendingFavorite.value = null; const saved = storage.get(favoriteKey(ctx.uid));
    if (saved === undefined || saved === null || saved === '') return null;
    let intent: RecipeFavoriteMutation;
    try { intent = parseFavoriteMutation(saved); } catch { throw new AppError('UNAVAILABLE'); }
    if (intent.familyId !== ctx.familyId || intent.generation !== ctx.generation) { storage.remove(favoriteKey(ctx.uid)); return null; }
    pendingFavorite.value = intent; return intent;
  }
  function favorite(id: string, enabled: boolean): Promise<void> {
    const ctx = current(); validId(id);
    if (typeof enabled !== 'boolean') return Promise.reject(new AppError('INVALID_INPUT'));
    if (favoriteFlight) return favoriteFlight.id === id && favoriteFlight.enabled === enabled ? favoriteFlight.promise : Promise.reject(new AppError('CONFLICT'));
    const original = restoreFavorite();
    if (original && (original.id !== id || original.enabled !== enabled)) return Promise.reject(new AppError('CONFLICT'));
    const promise = Promise.resolve().then(async () => {
      const intent = original ?? parseFavoriteMutation({ requestId: await newRequestId(), familyId: ctx.familyId, generation: ctx.generation, id, enabled });
      if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      storage.set(favoriteKey(ctx.uid), intent); pendingFavorite.value = intent;
      try {
        await api.favorite(intent);
        if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
        // Receipt replay confirms the operation; get projects the latest state after other devices' changes.
        const result = await api.get(intent.id);
        if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
        if (result.familyId !== ctx.familyId || result.id !== id) throw new AppError('UNAVAILABLE');
        storage.remove(favoriteKey(ctx.uid)); pendingFavorite.value = null;
        if (recipe.value?.id === id) recipe.value = result;
        const refresh = !!listFlight; listRevision++; listFlight = null;
        items.value = items.value.map(row => row.id === id ? result : row).filter(row => !filters.value.favoritesOnly || row.isFavorite);
        if (refresh) await list();
      } catch (error) {
        if (active(ctx) && !['UNAVAILABLE', 'QUOTA_EXCEEDED'].includes(errorCode(error))) { storage.remove(favoriteKey(ctx.uid)); pendingFavorite.value = null; }
        throw error;
      }
    }).finally(() => { if (favoriteFlight?.promise === promise) favoriteFlight = null; });
    favoriteFlight = { id, enabled, promise }; return promise;
  }
  function submit(input: RecipeInput, target?: { id: string; version: number }): Promise<Recipe> {
    if (flight) return flight;
    const ctx = current(); const original = restore(); const validated = original ? null : parseInput(input);
    flight = Promise.resolve().then(async () => {
      if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      const requestId = original?.input.requestId ?? await newRequestId();
      if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
      const base = { requestId, familyId: ctx.familyId, generation: ctx.generation, recipe: validated! };
      const intent: RecipeIntent = original ?? (target ? { kind: 'update', input: parseMutation({ ...base, ...target }, true) } : { kind: 'create', input: parseMutation(base, false) });
      storage.set(key(ctx.uid), intent); pending.value = intent;
      try {
        const result = intent.kind === 'create' ? await api.create(intent.input) : await api.update(intent.input);
        if (!active(ctx)) throw new AppError('FAMILY_REQUIRED');
        if (result.familyId !== ctx.familyId || (intent.kind === 'update' && result.id !== intent.input.id)) throw new AppError('UNAVAILABLE');
        storage.remove(key(ctx.uid)); pending.value = null; recipe.value = result; return result;
      } catch (error) {
        if (active(ctx) && ['CONFLICT', 'INVALID_INPUT'].includes(errorCode(error))) { storage.remove(key(ctx.uid)); pending.value = null; }
        throw error;
      }
    }).finally(() => { if (flight === attempt) flight = null; });
    const attempt = flight; return flight;
  }
  function list(more = false): Promise<void> {
    const ctx = current(); const cursor = more ? nextCursor.value : null;
    if (more && !cursor) return Promise.resolve();
    if (listFlight?.revision === listRevision && listFlight.cursor === cursor) return listFlight.promise;
    if (!more) resetList();
    const revision = listRevision; const query = { ...filters.value, ...(cursor ? { cursor } : {}) };
    const promise = Promise.resolve().then(async () => {
      const result = await api.list(query);
      if (!active(ctx) || revision !== listRevision) return;
      if (result.items.some(row => row.familyId !== ctx.familyId)) throw new AppError('UNAVAILABLE');
      items.value = more ? [...items.value, ...result.items.filter(row => !items.value.some(old => old.id === row.id))] : result.items;
      nextCursor.value = result.nextCursor;
    }).finally(() => { if (listFlight?.promise === promise) listFlight = null; });
    listFlight = { revision, cursor, promise }; return promise;
  }
  return {
    items: readonly(items), recipe: readonly(recipe), pending: readonly(pending), nextCursor: readonly(nextCursor), filters: readonly(filters), pendingFavorite: readonly(pendingFavorite), restore, submit, favorite,
    async retryFavorite() { const intent = restoreFavorite(); if (!intent) throw new AppError('INVALID_INPUT'); await favorite(intent.id, intent.enabled); },
    setFilters(input: { query: string; tag: string; favoritesOnly: boolean }) {
      current(); const value = parseListInput(input); filters.value = { query: value.query!, tag: value.tag!, favoritesOnly: value.favoritesOnly! }; resetList();
    },
    async retry() { const intent = restore(); if (!intent) throw new AppError('INVALID_INPUT'); return submit(intent.input.recipe); },
    async get(id: string) {
      const ctx = current(); const result = await api.get(id);
      if (!active(ctx)) return null;
      if (result.familyId !== ctx.familyId || result.id !== id) throw new AppError('UNAVAILABLE');
      recipe.value = result; return result;
    },
    list,
    clear: conceal,
    dispose() { disposed = true; stop(); conceal(); pending.value = null; },
  };
}
