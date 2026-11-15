import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
import { enterPage } from '../../shared/navigation';
import { copy } from '../../shared/copy';
import { errorCode } from '../../shared/errors';

export function usePlanningPage(load: () => Promise<void>) {
  const app = useAppClient(); const confirmed = ref(false); const busy = ref(false); const message = ref('');
  // This scope survives a same-family recheck/hide, not logout, membership replacement or unload.
  // A page owns its draft and base version; load must not overwrite a draft with this same scope.
  const draftScope = ref(app.planning.draftScope.value);
  let active = false; let disposed = false; let epoch = 0; let visibility = 0; let authorized = false; let redirected = false;
  function login() { if (active && !redirected) { redirected = true; uni.reLaunch({ url: '/pages/account/login' }); } }
  const stopScope = watch(app.planning.draftScope, value => { draftScope.value = value; }, { flush: 'sync' });
  const stop = watch([app.auth.phase, app.family.phase, () => app.auth.identity.value?.uid, () => app.family.view.value?.familyId, () => app.family.view.value?.generation], ([phase]) => {
    epoch++; confirmed.value = false; busy.value = false;
    if (phase === 'anonymous' && authorized) login();
  }, { flush: 'sync' });
  async function reconcile(error: unknown) {
    if (!active || disposed) return;
    const showing = visibility; message.value = copy.planningErrors[errorCode(error)];
    if (errorCode(error) === 'AUTH_REQUIRED') { confirmed.value = false; await app.auth.signOut().catch(() => {}); if (active && showing === visibility) login(); }
    else if (['FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) {
      confirmed.value = false; app.planning.clear(); await app.family.load().catch(() => {});
      if (active && showing === visibility && app.family.phase.value === 'ready' && !app.family.view.value) uni.reLaunch({ url: '/pages/family/onboarding' });
    }
  }
  function revokedHere(showing: number, uid: string | undefined) {
    return active && !disposed && showing === visibility && app.auth.identity.value?.uid === uid && !!uid
      && app.auth.phase.value === 'authenticated' && app.family.phase.value === 'idle' && app.planning.draftScope.value === null;
  }
  async function check() {
    if (disposed) return;
    active = true; authorized = false; redirected = false; confirmed.value = false; busy.value = false; message.value = '';
    const showing = ++visibility; const visible = () => active && showing === visibility && !disposed;
    const guard = createRouteGuard(app.auth, url => { if (visible()) { if (url === '/pages/account/login') login(); else enterPage(url); } }, app.family, app.membership, visible);
    if (!await guard.ensureFamily('home') || !visible()) { if (visible()) message.value = copy.familyUnavailable; return; }
    const current = epoch; const uid = app.auth.identity.value?.uid;
    app.planning.activate(); authorized = true; confirmed.value = true;
    try { app.planning.restore(); await load(); }
    catch (error) { if (visible() && current === epoch || revokedHere(showing, uid)) await reconcile(error); }
    // confirmed means the scope was verified, not that a read succeeded. Read failures keep retry usable.
  }
  async function act(action: (isCurrent: () => boolean) => Promise<unknown>, replace = false) {
    if (!active || !confirmed.value || busy.value && !replace) return;
    if (replace) epoch++;
    const current = epoch; const showing = visibility; const uid = app.auth.identity.value?.uid; busy.value = true; message.value = '';
    const isCurrent = () => active && !disposed && current === epoch && showing === visibility && confirmed.value;
    try {
      await action(isCurrent);
      if (app.planning.readError.value) {
        if (isCurrent()) message.value = copy.planningErrors[app.planning.readError.value];
        else if (revokedHere(showing, uid)) await reconcile({ code: app.planning.readError.value });
      }
    } catch (error) { if (isCurrent() || revokedHere(showing, uid)) await reconcile(error); }
    finally { if (current === epoch) busy.value = false; }
  }
  function conceal() {
    const wasActive = active; active = false; authorized = false; visibility++; epoch++; confirmed.value = false; busy.value = false; message.value = '';
    if (wasActive) app.planning.clear();
  }
  onShow(check); onHide(conceal); onUnload(() => { disposed = true; conceal(); stop(); stopScope(); draftScope.value = null; });
  return { ...app, confirmed, busy, message, draftScope, check, act, reconcile,
    isCurrent: () => active && !disposed && confirmed.value,
    back: () => { if (active && confirmed.value) uni.switchTab({ url: '/pages/planning/index' }); },
  };
}
