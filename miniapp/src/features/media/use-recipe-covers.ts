import { readonly, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { onHide, onUnload } from '@dcloudio/uni-app';
import type { MediaApi } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import { errorCode } from '../../shared/errors';

type Cover = { label: string; url?: string; expiresAt?: number; failed?: boolean };
const labels = { requested: '图片尚未上传', uploading: '图片上传中', uploaded: '图片待校验', checking: '图片校验中', pending: '图片审核中', ready: '图片加载中', rejected: '图片审核未通过', 'review-error': '图片审核异常', failed: '图片上传失败' };

export function useRecipeCovers(options: { api: MediaApi; auth: AuthController; family: ReturnType<typeof createFamilyController>; items: Readonly<Ref<readonly { readonly id: string; readonly imageIds: readonly string[] }[]>>; visible: Ref<boolean>; onAccessError(error: unknown): Promise<void> }) {
  const covers = ref<Record<string, Cover>>({}); let revision = 0; let timer: ReturnType<typeof setTimeout> | undefined;
  function clear() { revision++; if (timer) clearTimeout(timer); timer = undefined; covers.value = {}; }
  async function refresh() {
    if (timer) clearTimeout(timer);
    const view = options.family.view.value; const current = ++revision;
    if (!options.visible.value || !view || options.auth.phase.value !== 'authenticated' || options.family.phase.value !== 'ready') { clear(); return; }
    const valid = () => current === revision && options.visible.value && options.auth.phase.value === 'authenticated'
      && options.auth.identity.value?.uid === view.uid && options.family.phase.value === 'ready'
      && options.family.view.value?.familyId === view.familyId && options.family.view.value.generation === view.generation;
    const ids = [...new Set(options.items.value.flatMap(item => item.imageIds.slice(0, 1)))];
    const scope = { familyId: view.familyId, generation: view.generation };
    const values: Record<string, Cover> = {};
    for (const id of ids) values[id] = covers.value[id]?.expiresAt && covers.value[id].expiresAt! > Date.now() ? covers.value[id] : { label: '图片加载中' };
    covers.value = { ...values }; let reviewing = false;
    async function failure(error: unknown, batch: string[]) {
      if (!valid()) return;
      if (['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) { clear(); await options.onAccessError(error); return; }
      for (const id of batch) values[id] = { label: '图片加载失败', failed: true };
    }
    for (let start = 0; start < ids.length && valid(); start += 20) {
      const batch = ids.slice(start, start + 20);
      try {
        const result = await options.api.status({ ...scope, mediaIds: batch }); if (!valid()) return;
        await Promise.all(result.map(async item => {
          if (item.state !== 'ready') {
            values[item.mediaId] = { label: labels[item.state] };
            reviewing ||= ['uploading', 'uploaded', 'checking', 'pending'].includes(item.state); return;
          }
          try {
            const old = values[item.mediaId];
            if (old?.url && old.expiresAt! > Date.now()) return;
            const link = await options.api.read({ ...scope, mediaId: item.mediaId });
            if (valid()) values[item.mediaId] = { label: '菜谱封面', url: link.url, expiresAt: link.expiresAt };
          } catch (error) { await failure(error, [item.mediaId]); }
        }));
      } catch (error) { await failure(error, batch); }
      if (valid()) covers.value = { ...values };
    }
    if (!valid()) return;
    const deadlines = Object.values(values).flatMap(value => value.expiresAt ? [value.expiresAt] : []);
    if (reviewing) deadlines.push(Date.now() + 3000);
    if (deadlines.length) timer = setTimeout(() => { void refresh(); }, Math.max(1, Math.min(2_147_483_647, Math.min(...deadlines) - Date.now())));
  }
  function failed(id: string) { covers.value[id] = { label: '图片加载失败', failed: true }; }
  const stop = watch([options.visible, () => options.items.value.map(item => item.id + ':' + item.imageIds[0]).join(','), options.auth.phase, () => options.auth.identity.value?.uid, options.family.phase, () => options.family.view.value?.generation], () => { clear(); void refresh(); }, { flush: 'sync' });
  onHide(clear); onUnload(() => { stop(); clear(); });
  return { covers: readonly(covers), refresh, failed };
}
