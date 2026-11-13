import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onHide, onUnload } from '@dcloudio/uni-app';
import type { MediaUploadRequest, MediaView } from 'home-contracts';
import type { useRecipesPage } from '../recipes/use-recipes-page';
import { readImageSelection } from '../media/image-file';
import { newRequestId } from '../family/intents';
import { AppError, errorCode } from '../../shared/errors';

export function useImportImage(page: ReturnType<typeof useRecipesPage>) {
  const item = ref<MediaView | null>(null); const path = ref(''); const message = ref(''); const busy = ref(false);
  let intent: MediaUploadRequest | null = null; let base64: string | null = null; let serial = 0; let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined; let refreshing = false;
  const scope = () => { const value = page.family.view.value; return value ? value.uid + ':' + value.familyId + ':' + value.generation : ''; };
  let ownerScope = ''; let ownerUid: string | undefined;
  function pause() { if (timer) clearTimeout(timer); timer = undefined; }
  function clear() { serial++; pause(); item.value = null; path.value = ''; message.value = ''; intent = null; base64 = null; busy.value = false; ownerScope = ''; ownerUid = undefined; }
  const current = (version: number) => !disposed && version === serial && scope() === ownerScope && page.auth.identity.value?.uid === ownerUid;
  function refInput() { const view = page.family.view.value; if (!view || !item.value) throw new AppError('FAMILY_REQUIRED'); return { familyId: view.familyId, generation: view.generation, mediaId: item.value.mediaId }; }
  function report(error: unknown) { message.value = errorCode(error) === 'INVALID_INPUT' ? '请选择一张不超过 1 MiB 的 JPEG 或 PNG 菜谱图片。' : '图片处理暂未完成，请重试；审核服务须已启用。'; }
  async function refresh() {
    pause(); if (refreshing || !item.value || !page.isCurrent()) return;
    const version = serial; refreshing = true;
    try {
      const { mediaId, ...context } = refInput();
      const [result] = await page.client.media.status({ ...context, mediaIds: [mediaId] });
      if (!current(version) || !page.isCurrent()) return;
      item.value = result;
      if (['pending', 'checking', 'uploading'].includes(result.state)) timer = setTimeout(() => { void refresh(); }, 3000);
    } catch (error) { if (current(version) && page.isCurrent()) report(error); }
    finally { refreshing = false; }
  }
  async function upload(isCurrent: () => boolean) {
    const version = serial; if (!intent) return;
    if (!item.value) {
      const result = await page.client.media.requestUpload(intent);
      if (!current(version)) return; item.value = result;
    }
    if (!isCurrent()) return;
    if (base64 !== null && ['requested', 'uploading', 'uploaded'].includes(item.value.state)) {
      const result = await page.client.media.upload({ ...refInput(), base64 });
      if (!current(version)) return; item.value = result; base64 = null;
    }
    if (!isCurrent()) return;
    if (['uploaded', 'review-error'].includes(item.value.state)) {
      const result = await page.client.media.complete(refInput());
      if (!current(version)) return; item.value = result;
    }
    if (isCurrent()) await refresh();
  }
  function choose() { void page.act(async (isCurrent, resume) => {
    if (busy.value) return;
    const initialScope = scope(); const uid = page.auth.identity.value?.uid; const signOut = page.auth.signOutEpoch.value; const version = serial;
    let selected: UniApp.ChooseImageSuccessCallbackResult;
    try { selected = await uni.chooseImage({ count: 1, sizeType: ['original'], sourceType: ['album', 'camera'] }); }
    catch (error) { if (String((error as { errMsg?: string })?.errMsg).includes('cancel')) return; report(error); return; }
    if (!isCurrent() && !await resume()) return;
    if (disposed || version !== serial || scope() !== initialScope || page.auth.identity.value?.uid !== uid || page.auth.signOutEpoch.value !== signOut) return;
    clear(); ownerScope = initialScope; ownerUid = uid; const selectedVersion = serial; busy.value = true;
    try {
      const file = await readImageSelection(selected); if (!current(selectedVersion) || !isCurrent()) return;
      const requestId = await newRequestId(); if (!current(selectedVersion) || !isCurrent()) return;
      const view = page.family.view.value!; path.value = file.path; base64 = file.base64;
      intent = { requestId, familyId: view.familyId, generation: view.generation, purpose: 'import-input', mime: file.mime, bytes: file.bytes };
      await upload(isCurrent);
    } catch (error) { if (current(selectedVersion)) report(error); }
    finally { if (current(selectedVersion)) busy.value = false; }
  }); }
  function retry() { void page.act(async isCurrent => {
    if (busy.value) return; const version = serial; busy.value = true; message.value = '';
    try { await upload(isCurrent); } catch (error) { if (current(version)) report(error); }
    finally { if (current(version)) busy.value = false; }
  }); }
  function restore(mediaId: string) {
    if (item.value?.mediaId === mediaId) return;
    clear(); ownerScope = scope(); ownerUid = page.auth.identity.value?.uid;
    item.value = { mediaId, state: 'uploaded', uploadExpiresAt: 0, review: 'weixin', retryable: false };
  }
  const stop = watch([page.auth.phase, () => page.auth.identity.value?.uid, page.family.phase, page.family.view], ([phase, uid, familyPhase]) => {
    if (phase === 'anonymous' || phase === 'signing-out' || ownerUid && uid && ownerUid !== uid || familyPhase === 'ready' && ownerScope && scope() !== ownerScope) clear();
  }, { flush: 'sync' });
  watch(page.confirmed, ready => { if (ready) void refresh(); else pause(); });
  onHide(pause); onUnload(() => { disposed = true; clear(); }); onBeforeUnmount(() => { disposed = true; clear(); stop(); });
  const status = computed(() => !item.value ? busy.value ? '正在读取图片…' : '' : ({ requested: '等待上传，请重试', uploading: '正在上传图片', uploaded: '等待提交审核', checking: '正在提交审核', pending: '等待审核', ready: item.value.review === 'disabled' ? '图片审核未启用，无法导入' : '图片已通过审核，可以导入', rejected: '图片未通过审核，请重新选择', 'review-error': '图片审核暂不可用，请重试', failed: '图片已失效，请重新选择' })[item.value.state]);
  return { item, path, message, busy, status, choose, retry, refresh, restore, clear,
    canSubmit: computed(() => item.value?.state === 'ready' && item.value.review !== 'disabled' && !busy.value),
    canRetry: computed(() => !!intent && (!!base64 || item.value?.state === 'uploaded' || item.value?.retryable)),
    preview() { if (path.value && page.isCurrent()) void uni.previewImage({ current: path.value, urls: [path.value] }); },
  };
}
