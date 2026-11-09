import { readonly, ref, watch } from 'vue';
import type { FamilyView, Recipe, RecipeInput, RecipeMutation, RecipeUpdate, RecipesApi } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, parseInput, parseMutation } from './validation';

export type RecipeIntent = { kind: 'create'; input: RecipeMutation } | { kind: 'update'; input: RecipeUpdate };
export function createRecipesController({ api, auth, family, storage, newRequestId }: {
  api: RecipesApi; auth: AuthController; family: ReturnType<typeof createFamilyController>; storage: SessionStorage; newRequestId(): Promise<string>;
}) {
  const items = ref<Recipe[]>([]); const recipe = ref<Recipe | null>(null); const pending = ref<RecipeIntent | null>(null); const nextCursor = ref<string | null>(null);
  let epoch = 0; let disposed = false; let scope: FamilyView | null = null; let uid = auth.identity.value?.uid;
  let flight: Promise<Recipe> | null = null;
  const key = (value: string) => 'home.recipes.pending.v1:' + encodeURIComponent(value);
  function conceal() { epoch++; items.value = []; recipe.value = null; nextCursor.value = null; }
  function forget(value?: string) { conceal(); pending.value = null; if (value) { try { storage.remove(key(value)); } catch { /* State remains hidden if storage is unavailable. */ } } }
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
    const ctx = current(); const value = storage.get(key(ctx.uid)); pending.value = null;
    if (value === undefined || value === null || value === '') return null;
    const row = object(value, ['kind', 'input']);
    const intent: RecipeIntent = row.kind === 'create' ? { kind: 'create', input: parseMutation(row.input, false) }
      : row.kind === 'update' ? { kind: 'update', input: parseMutation(row.input, true) } : (() => { throw new AppError('UNAVAILABLE'); })();
    if (intent.input.familyId !== ctx.familyId || intent.input.generation !== ctx.generation) { storage.remove(key(ctx.uid)); return null; }
    pending.value = intent; return intent;
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
  return {
    items: readonly(items), recipe: readonly(recipe), pending: readonly(pending), nextCursor: readonly(nextCursor), restore, submit,
    async retry() { const intent = restore(); if (!intent) throw new AppError('INVALID_INPUT'); return submit(intent.input.recipe); },
    async get(id: string) {
      const ctx = current(); const result = await api.get(id);
      if (!active(ctx)) return null;
      if (result.familyId !== ctx.familyId || result.id !== id) throw new AppError('UNAVAILABLE');
      recipe.value = result; return result;
    },
    async list(more = false) {
      const ctx = current(); const cursor = more ? nextCursor.value : null;
      if (more && !cursor) return;
      const result = await api.list(cursor ? { cursor } : {});
      if (!active(ctx)) return;
      if (result.items.some(row => row.familyId !== ctx.familyId)) throw new AppError('UNAVAILABLE');
      items.value = more ? [...items.value, ...result.items.filter(row => !items.value.some(old => old.id === row.id))] : result.items;
      nextCursor.value = result.nextCursor;
    },
    clear: conceal,
    dispose() { disposed = true; stop(); conceal(); pending.value = null; },
  };
}
