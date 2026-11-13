import { computed, readonly, ref, watch } from 'vue';
import type { MediaApi, MediaLink, MediaUploadRequest, MediaView, Recipe, RecipeImagesMutation, RecipesApi } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, parseImagesMutation, validId } from '../recipes/validation';
import { parseMediaRequest } from './api';
import { readImageSelection } from './image-file';

type UploadIntent = { input: MediaUploadRequest; mediaId: string | null };
type Draft = { familyId: string; generation: string; recipeId: string; imageIds: string[]; requests: UploadIntent[]; pending: RecipeImagesMutation | null };
type ImageRecipe = Pick<Recipe, 'id' | 'familyId'> & { readonly imageIds: readonly string[] };
export function createMediaController(options: { api: MediaApi; recipes: RecipesApi; auth: AuthController; family: ReturnType<typeof createFamilyController>; storage: SessionStorage; newRequestId(): Promise<string> }) {
  const items = ref<MediaView[]>([]); const links = ref<Record<string, MediaLink>>({}); const pending = ref<RecipeImagesMutation | null>(null);
  let draft: Draft | null = null; let epoch = 0; let visible = false; let disposed = false; let owner = options.auth.identity.value?.uid;
  let timer: ReturnType<typeof setTimeout> | undefined; let binding: Promise<Recipe> | null = null;
  const key = (uid: string) => 'home.media.pending.v1:' + encodeURIComponent(uid);
  function conceal() { epoch++; visible = false; items.value = []; links.value = {}; pending.value = null; draft = null; binding = null; if (timer) clearTimeout(timer); }
  function forget() { conceal(); if (owner) { try { options.storage.remove(key(owner)); } catch { /* Keep protected state hidden when storage fails. */ } } }
  let lastScope = '';
  const stop = watch([options.auth.phase, () => options.auth.identity.value?.uid, options.family.phase, options.family.view], ([phase, uid, familyPhase, view]) => {
    const scope = view ? view.uid + ':' + view.familyId + ':' + view.generation : '';
    if (phase === 'anonymous' || phase === 'signing-out' || uid && owner && uid !== owner || familyPhase === 'ready' && lastScope && scope !== lastScope) forget();
    else if (phase !== 'authenticated' || familyPhase !== 'ready') conceal();
    if (uid) owner = uid; if (familyPhase === 'ready') lastScope = scope;
  }, { flush: 'sync' });
  function current() {
    const view = options.family.view.value;
    if (!visible || disposed || options.auth.phase.value !== 'authenticated' || options.family.phase.value !== 'ready' || !view || view.uid !== options.auth.identity.value?.uid) throw new AppError('FAMILY_REQUIRED');
    return { uid: view.uid, familyId: view.familyId, generation: view.generation, epoch };
  }
  const active = (ctx: ReturnType<typeof current>) => visible && !disposed && ctx.epoch === epoch && options.auth.phase.value === 'authenticated'
    && options.auth.identity.value?.uid === ctx.uid && options.family.phase.value === 'ready' && options.family.view.value?.familyId === ctx.familyId && options.family.view.value.generation === ctx.generation;
  function savedRecipes(ctx: ReturnType<typeof current>): Record<string, unknown> {
    const raw = options.storage.get(key(ctx.uid)); if (!raw) return {};
    const row = object(raw, ['familyId', 'generation', 'recipes']);
    if (row.familyId !== ctx.familyId || row.generation !== ctx.generation) { options.storage.remove(key(ctx.uid)); return {}; }
    if (!row.recipes || typeof row.recipes !== 'object' || Array.isArray(row.recipes)) throw new AppError('UNAVAILABLE');
    Object.keys(row.recipes).forEach(validId); return row.recipes as Record<string, unknown>;
  }
  function persist(ctx: ReturnType<typeof current>) {
    if (!active(ctx) || !draft) throw new AppError('FAMILY_REQUIRED');
    const recipes = { ...savedRecipes(ctx), [draft.recipeId]: draft };
    options.storage.set(key(ctx.uid), JSON.parse(JSON.stringify({ familyId: ctx.familyId, generation: ctx.generation, recipes }))); pending.value = draft.pending;
  }
  function restore(value: unknown, recipe: ImageRecipe, ctx: ReturnType<typeof current>): Draft | null {
    if (!value) return null;
    try {
      const row = object(value, ['familyId', 'generation', 'recipeId', 'imageIds', 'requests', 'pending']);
      if (row.familyId !== ctx.familyId || row.generation !== ctx.generation) { options.storage.remove(key(ctx.uid)); return null; }
      if (row.recipeId !== recipe.id) return null;
      if (!Array.isArray(row.imageIds) || row.imageIds.length > 20 || !Array.isArray(row.requests) || row.requests.length > 20) throw new Error();
      const imageIds = row.imageIds.map(validId); if (new Set(imageIds).size !== imageIds.length) throw new Error();
      const requests = row.requests.map(value => {
        const upload = object(value, ['input', 'mediaId']); const input = parseMediaRequest(upload.input);
        if (input.familyId !== ctx.familyId || input.generation !== ctx.generation) throw new Error();
        return { input, mediaId: upload.mediaId === null ? null : validId(upload.mediaId) };
      });
      const pending = row.pending === null ? null : parseImagesMutation(row.pending);
      if (pending && (pending.familyId !== ctx.familyId || pending.generation !== ctx.generation || pending.id !== recipe.id)) throw new Error();
      return { familyId: ctx.familyId, generation: ctx.generation, recipeId: recipe.id, imageIds, requests, pending };
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  async function initialize(recipe: ImageRecipe, edit = false) {
    conceal(); visible = true; const ctx = current();
    if (recipe.familyId !== ctx.familyId) throw new AppError('UNAVAILABLE');
    draft = edit ? restore(savedRecipes(ctx)[recipe.id], recipe, ctx) : null;
    draft ??= { familyId: ctx.familyId, generation: ctx.generation, recipeId: recipe.id, imageIds: [...recipe.imageIds], requests: [], pending: null };
    pending.value = draft.pending;
    for (const request of draft.requests) {
      if (!request.mediaId) {
        const result = await options.api.requestUpload(request.input); if (!active(ctx)) return;
        request.mediaId = result.mediaId; if (!draft!.imageIds.includes(result.mediaId)) draft!.imageIds.push(result.mediaId); persist(ctx);
      }
    }
    await refresh();
  }
  async function refresh() {
    const ctx = current(); if (!draft) return;
    const ids = [...draft.imageIds];
    const result = ids.length ? await options.api.status({ familyId: ctx.familyId, generation: ctx.generation, mediaIds: ids }) : [];
    if (!active(ctx) || !draft || JSON.stringify(ids) !== JSON.stringify(draft.imageIds)) return;
    items.value = result; const values: Record<string, MediaLink> = {};
    await Promise.all(result.filter(item => item.state === 'ready').map(async item => {
      const old = links.value[item.mediaId]; values[item.mediaId] = old && old.expiresAt > Date.now() + 10_000 ? old : await options.api.read({ familyId: ctx.familyId, generation: ctx.generation, mediaId: item.mediaId });
    }));
    if (!active(ctx)) return; links.value = values;
    if (timer) clearTimeout(timer);
    if (items.value.some(item => ['uploading', 'checking', 'pending'].includes(item.state))) timer = setTimeout(() => { if (active(ctx)) void refresh().catch(() => {}); }, 3000);
  }
  async function choose(isCurrent: () => boolean, resume: () => Promise<boolean>) {
    let ctx = current(); if (!draft || draft.pending || draft.imageIds.length + draft.requests.filter(request => request.mediaId === null).length >= 20) throw new AppError('CONFLICT');
    const recipeId = draft.recipeId; const signOutEpoch = options.auth.signOutEpoch.value;
    let chosen: UniApp.ChooseImageSuccessCallbackResult;
    try { chosen = await uni.chooseImage({ count: 1, sizeType: ['original'], sourceType: ['album', 'camera'] }); }
    catch (error) { if (String((error as { errMsg?: string })?.errMsg).includes('cancel')) return; throw new AppError('UNAVAILABLE'); }
    if (!active(ctx) || !isCurrent()) {
      if (!await resume()) return;
      const fresh = current();
      if (fresh.uid !== ctx.uid || fresh.familyId !== ctx.familyId || fresh.generation !== ctx.generation
        || options.auth.signOutEpoch.value !== signOutEpoch || draft?.recipeId !== recipeId) return;
      ctx = fresh;
    }
    if (!draft || draft.pending || draft.imageIds.length + draft.requests.filter(request => request.mediaId === null).length >= 20) throw new AppError('CONFLICT');
    const { base64, mime, bytes } = await readImageSelection(chosen);
    if (!active(ctx) || !isCurrent() || !draft) return;
    const requestId = await options.newRequestId(); if (!active(ctx) || !isCurrent() || !draft) return;
    const upload: UploadIntent = { input: { requestId, familyId: ctx.familyId, generation: ctx.generation, purpose: 'recipe-image', mime, bytes }, mediaId: null };
    draft.requests.push(upload); persist(ctx);
    const requested = await options.api.requestUpload(upload.input); if (!active(ctx) || !isCurrent() || !draft) return;
    upload.mediaId = requested.mediaId; draft.imageIds.push(requested.mediaId); persist(ctx); items.value.push(requested);
    const ref = { familyId: ctx.familyId, generation: ctx.generation, mediaId: requested.mediaId };
    await options.api.upload({ ...ref, base64 }); if (!active(ctx) || !isCurrent()) return;
    await options.api.complete(ref); if (!active(ctx) || !isCurrent()) return;
    await refresh();
  }
  function remove(id: string) {
    const ctx = current(); if (!draft || draft.pending) throw new AppError('CONFLICT');
    draft.imageIds = draft.imageIds.filter(value => value !== id); draft.requests = draft.requests.filter(value => value.mediaId !== id);
    items.value = items.value.filter(value => value.mediaId !== id); delete links.value[id]; persist(ctx);
  }
  async function retry(id: string) {
    const ctx = current(); await options.api.complete({ familyId: ctx.familyId, generation: ctx.generation, mediaId: validId(id) });
    if (active(ctx)) await refresh();
  }
  function save(id: string, version: number): Promise<Recipe> {
    if (binding) return binding;
    const ctx = current(); if (!draft || draft.recipeId !== id) throw new AppError('CONFLICT');
    const promise = Promise.resolve().then(async () => {
      if (!draft || !active(ctx)) throw new AppError('FAMILY_REQUIRED');
      if (!draft.pending) {
        if (items.value.length !== draft.imageIds.length || items.value.some(item => item.state !== 'ready')) throw new AppError('INVALID_INPUT');
        const requestId = await options.newRequestId(); if (!draft || !active(ctx)) throw new AppError('FAMILY_REQUIRED');
        draft.pending = parseImagesMutation({ requestId, familyId: ctx.familyId, generation: ctx.generation, id, version, imageIds: [...draft.imageIds] }); persist(ctx);
      }
      try {
        const result = await options.recipes.bindImages(draft.pending);
        if (!active(ctx) || !draft) throw new AppError('FAMILY_REQUIRED');
        if (result.id !== id || result.familyId !== ctx.familyId) throw new AppError('UNAVAILABLE');
        draft.pending = null; draft.imageIds = [...result.imageIds]; draft.requests = []; pending.value = null;
        const recipes = { ...savedRecipes(ctx) }; delete recipes[id];
        if (Object.keys(recipes).length) options.storage.set(key(ctx.uid), { familyId: ctx.familyId, generation: ctx.generation, recipes }); else options.storage.remove(key(ctx.uid));
        return result;
      } catch (error) {
        if (active(ctx) && draft && ['CONFLICT', 'INVALID_INPUT'].includes(errorCode(error))) { draft.pending = null; persist(ctx); }
        throw error;
      }
    }).finally(() => { if (binding === promise) binding = null; });
    binding = promise; return promise;
  }
  async function preview(id: string) {
    const ctx = current(); const ref = { familyId: ctx.familyId, generation: ctx.generation, mediaId: validId(id) };
    const link = await options.api.read(ref); if (!active(ctx)) return;
    links.value[id] = link;
    await uni.previewImage({ current: link.url, urls: [link.url] });
  }
  return { items: readonly(items), links: readonly(links), pending: readonly(pending), canSave: computed(() => !!draft && (pending.value !== null || items.value.length === draft.imageIds.length && items.value.every(item => item.state === 'ready'))),
    initialize, refresh, choose, remove, retry, save, preview, clear: conceal, dispose() { disposed = true; stop(); conceal(); } };
}
