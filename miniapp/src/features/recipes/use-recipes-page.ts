import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
import { copy } from '../../shared/copy';
import { errorCode } from '../../shared/errors';

export function useRecipesPage(load: () => Promise<void>) {
  const app = useAppClient(); const confirmed = ref(false); const busy = ref(false); const message = ref('');
  let epoch = 0; let visibility = 0; let active = false; let checking = false; let disposed = false;
  const resumes = new Set<(ready: boolean) => void>();
  function finishResumes(ready: boolean) { for (const resolve of resumes) resolve(ready); resumes.clear(); }
  const stop = watch([app.auth.phase, app.family.phase, () => app.auth.identity.value?.uid, () => app.family.view.value?.generation], () => { confirmed.value = false; epoch++; }, { flush: 'sync' });
  async function check() {
    if (disposed) return;
    active = true; checking = true; confirmed.value = false; message.value = ''; busy.value = false;
    const showing = ++visibility; const visible = () => active && showing === visibility;
    const guard = createRouteGuard(app.auth, url => { if (visible()) uni.reLaunch({ url }); }, app.family, app.membership, visible);
    try {
      if (!await guard.ensureFamily('home') || !visible()) { if (visible()) message.value = copy.familyUnavailable; return; }
      const current = epoch;
      try {
        app.recipes.restore(); await load();
        if (visible() && current === epoch) confirmed.value = true;
      } catch (error) { if (visible() && current === epoch) { message.value = copy.recipeErrors[errorCode(error)]; await reconcile(error); } }
    } finally { if (visible()) { checking = false; finishResumes(confirmed.value); } }
  }
  async function reconcile(error: unknown) {
    if (errorCode(error) === 'AUTH_REQUIRED') { await app.auth.signOut().catch(() => {}); if (active) uni.reLaunch({ url: '/pages/account/login' }); }
    else if (['FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) {
      confirmed.value = false; await app.family.load().catch(() => {});
      if (active && app.family.phase.value === 'ready' && !app.family.view.value) uni.reLaunch({ url: '/pages/family/onboarding' });
    }
  }
  async function act(action: (isCurrent: () => boolean, resume: () => Promise<boolean>) => Promise<void>, replace = false) {
    if (!active || !confirmed.value || busy.value && !replace) return;
    if (replace) epoch++;
    let current = epoch; busy.value = true; message.value = '';
    async function resume() {
      if (disposed) return false;
      // Native media pickers hide the app; wait for onShow to revalidate before resuming.
      if ((!active || checking) && !await new Promise<boolean>(resolve => resumes.add(resolve))) return false;
      if (!active || !confirmed.value) return false;
      current = epoch; busy.value = true; return true;
    }
    try { await action(() => active && current === epoch && confirmed.value, resume); }
    catch (error) { if (active && current === epoch) { message.value = copy.recipeErrors[errorCode(error)]; await reconcile(error); } }
    finally { if (current === epoch) busy.value = false; }
  }
  function conceal() {
    const wasActive = active; active = false; visibility++; epoch++; confirmed.value = false; busy.value = false;
    if (wasActive) { app.recipes.clear(); app.media.clear(); app.imports.clear(); }
  }
  onShow(check); onHide(conceal); onUnload(() => { disposed = true; conceal(); finishResumes(false); stop(); });
  return { ...app, confirmed, busy, message, check, act, isCurrent: () => active && confirmed.value, back: () => uni.reLaunch({ url: '/pages/family/home' }) };
}
