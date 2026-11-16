import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
import { enterPage } from '../../shared/navigation';
import { errorCode } from '../../shared/errors';
import { copy } from '../../shared/copy';

export function useShoppingPage(load: () => Promise<void>) {
  const app = useAppClient(); const confirmed = ref(false); const busy = ref(false); const message = ref('');
  let active = false; let disposed = false; let epoch = 0; let visibility = 0;
  const stop = watch([app.auth.phase, app.family.phase, () => app.auth.identity.value?.uid, () => app.family.view.value?.generation], () => { epoch++; confirmed.value = false; busy.value = false; }, { flush: 'sync' });
  const isCurrent = () => active && !disposed && confirmed.value;
  async function reconcile(error: unknown) {
    if (!active || disposed) return; const code = errorCode(error); message.value = copy.shoppingErrors[code];
    if (code === 'AUTH_REQUIRED') { confirmed.value = false; await app.auth.signOut().catch(() => {}); if (active) uni.reLaunch({ url: '/pages/account/login' }); }
    else if (code === 'FAMILY_REQUIRED' || code === 'FORBIDDEN') { confirmed.value = false; app.shopping.clear(); await app.family.load().catch(() => {}); if (active && app.family.phase.value === 'ready' && !app.family.view.value) uni.reLaunch({ url: '/pages/family/onboarding' }); }
  }
  async function check() {
    if (disposed) return; active = true; const showing = ++visibility; confirmed.value = false; message.value = ''; busy.value = true;
    const visible = () => active && !disposed && showing === visibility;
    const guard = createRouteGuard(app.auth, url => { if (visible()) enterPage(url); }, app.family, app.membership, visible);
    try {
      if (!await guard.ensureFamily('home') || !visible()) { if (visible()) message.value = copy.familyUnavailable; return; }
      app.shopping.activate(); confirmed.value = true; app.shopping.restore(); await load();
    } catch (error) { if (visible()) await reconcile(error); }
    finally { if (visible()) busy.value = false; }
  }
  async function act(action: (isCurrent: () => boolean) => Promise<unknown>, exclusive = true) {
    if (!isCurrent() || exclusive && busy.value) return; const revision = epoch; const showing = visibility; const uid = app.auth.identity.value?.uid; const scope = app.family.view.value;
    if (exclusive) busy.value = true; message.value = '';
    const current = () => isCurrent() && revision === epoch;
    const revokedHere = () => active && !disposed && showing === visibility && (app.auth.identity.value?.uid === uid || app.auth.phase.value === 'anonymous')
      && (!app.family.view.value || app.family.view.value.uid === uid && app.family.view.value.familyId === scope?.familyId && app.family.view.value.generation === scope.generation);
    try { await action(current); } catch (error) { if (current() || revokedHere() && ['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) await reconcile(error); }
    finally { if (exclusive && current()) busy.value = false; }
  }
  function conceal() { active = false; epoch++; visibility++; confirmed.value = false; busy.value = false; message.value = ''; app.shopping.clear(); }
  onShow(check); onHide(conceal); onUnload(() => { disposed = true; conceal(); stop(); });
  return { ...app, confirmed, busy, message, draftScope: app.shopping.draftScope, check, act, isCurrent, revision: () => visibility,
    back: () => { if (isCurrent()) uni.switchTab({ url: '/pages/shopping/index' }); },
  };
}
