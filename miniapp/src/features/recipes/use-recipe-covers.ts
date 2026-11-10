import { onUnmounted, readonly, ref, watch } from 'vue';
import type { MediaState } from 'home-contracts';
import type { useRecipesPage } from './use-recipes-page';
import { errorCode } from '../../shared/errors';

export type Cover = { state: MediaState | 'loading' | 'error' | 'expired'; url?: string; expiresAt?: number };

// Short links belong to this visible list only, never to persisted recipe/media drafts.
export function useRecipeCovers(page: ReturnType<typeof useRecipesPage>) {
  const covers = ref<Record<string, Cover>>({});
  let epoch = 0; let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const ids = () => [...new Set(page.recipes.items.value.flatMap(row => row.imageIds.slice(0, 1)))];
  function clear() { epoch++; covers.value = {}; if (timer) clearTimeout(timer); }
  function scheduleExpiry() {
    if (timer) clearTimeout(timer);
    const expiry = Object.values(covers.value).flatMap(value => value.expiresAt ? [value.expiresAt] : []);
    if (!expiry.length) return;
    timer = setTimeout(() => {
      for (const [id, value] of Object.entries(covers.value)) if (value.expiresAt && value.expiresAt <= Date.now()) covers.value[id] = { state: 'expired' };
      scheduleExpiry();
    }, Math.min(2_147_483_647, Math.max(1, Math.min(...expiry) - Date.now())));
  }
  async function load(requested: string[]) {
    const view = page.family.view.value; if (!view || !page.confirmed.value || disposed) return;
    const started = epoch;
    const current = () => !disposed && started === epoch && page.confirmed.value && page.family.view.value?.generation === view.generation;
    for (const id of requested) covers.value[id] = { state: 'loading' };
    await Promise.all(Array.from({ length: Math.ceil(requested.length / 20) }, async (_, index) => {
      const batch = requested.slice(index * 20, index * 20 + 20);
      try {
        const values = await page.client.media.status({ familyId: view.familyId, generation: view.generation, mediaIds: batch });
        if (!current()) return;
        await Promise.all(values.map(async value => {
          covers.value[value.mediaId] = { state: value.state };
          if (value.state !== 'ready') return;
          try {
            const link = await page.client.media.read({ familyId: view.familyId, generation: view.generation, mediaId: value.mediaId });
            if (current()) { covers.value[value.mediaId] = { state: 'ready', url: link.url, expiresAt: link.expiresAt }; scheduleExpiry(); }
          } catch (error) {
            if (current()) covers.value[value.mediaId] = { state: 'error' };
            if (['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) throw error;
          }
        }));
      } catch (error) {
        if (!current()) return;
        if (['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) { clear(); await page.reconcile(error); }
        else for (const id of batch) if (covers.value[id]?.state === 'loading') covers.value[id] = { state: 'error' };
      }
    }));
  }
  watch([page.confirmed, page.recipes.filters], () => { clear(); }, { flush: 'sync' });
  watch([page.confirmed, () => ids().join(',')], () => {
    if (!page.confirmed.value) return;
    const next = ids(); for (const id of Object.keys(covers.value)) if (!next.includes(id)) delete covers.value[id];
    void load(next.filter(id => !covers.value[id]));
  }, { flush: 'post' });
  onUnmounted(() => { disposed = true; clear(); });
  return { covers: readonly(covers), retry: (id: string) => load(ids().includes(id) && covers.value[id]?.state !== 'loading' ? [id] : []),
    fail(id: string) { if (covers.value[id]) covers.value[id] = { state: 'error' }; },
  };
}
