import { enterPage } from '../../shared/navigation';
import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { copy } from '../../shared/copy';
import { AppError, errorCode } from '../../shared/errors';

export function useFamilyPage(kind: 'invite' | 'join' | 'members') {
  const app = useAppClient(); const confirmed = ref(false); const busy = ref(false); const message = ref('');
  let active = false; let generation = 0; let lastUid = app.auth.identity.value?.uid;
  const stop = watch([app.auth.phase, () => app.auth.identity.value?.uid], ([phase, uid]) => {
    if (phase !== 'authenticated') confirmed.value = false;
    if (uid) { if (lastUid && lastUid !== uid) { generation++; confirmed.value = false; message.value = ''; busy.value = false; } lastUid = uid; }
  }, { flush: 'sync' });
  function showError(error: unknown) { message.value = (kind === 'members' ? copy.membershipErrors : copy.invitationErrors)[errorCode(error)]; }
  async function check() {
    const current = ++generation; active = true; confirmed.value = false; message.value = ''; busy.value = false;
    try {
      await app.family.load();
      if (!active || current !== generation) return;
      if (app.auth.phase.value === 'anonymous') { uni.reLaunch({ url: '/pages/account/login' }); return; }
      if (app.auth.phase.value !== 'authenticated' || app.family.phase.value !== 'ready') throw new AppError('UNAVAILABLE');
      if (await app.membership.resume()) await app.family.load();
      if (!active || current !== generation) return;
      if (app.auth.phase.value !== 'authenticated' || app.family.phase.value !== 'ready') throw new AppError('UNAVAILABLE');
      const view = app.family.view.value;
      if (kind !== 'join' && !view) { uni.reLaunch({ url: '/pages/family/onboarding' }); return; }
      if (kind === 'invite' && view?.role !== 'owner') { uni.switchTab({ url: '/pages/family/home' }); return; }
      if (kind === 'invite') await app.invitations.list();
      if (kind === 'members') await app.invitations.loadMembers();
      if (kind === 'join') app.invitations.restoreJoin();
      if (active && current === generation && app.auth.phase.value === 'authenticated') confirmed.value = true;
    } catch (error) {
      if (!active || current !== generation) return;
      if (app.auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
      else {
        if (['FAMILY_REQUIRED', 'FORBIDDEN', 'CONFLICT'].includes(errorCode(error))) {
          app.invitations.conceal();
          try {
            await app.family.load();
            if (!active || current !== generation) return;
            if (app.auth.phase.value === 'authenticated' && app.family.phase.value === 'ready') {
              if (!app.family.view.value) { uni.reLaunch({ url: '/pages/family/onboarding' }); return; }
              if (kind === 'invite' && app.family.view.value.role !== 'owner') { uni.switchTab({ url: '/pages/family/home' }); return; }
            }
          } catch { /* Failed reconciliation cannot confirm absence. */ }
        }
        if (active && current === generation) showError(error);
      }
    }
  }
  async function act(action: (isCurrent: () => boolean) => Promise<string | void>) {
    if (!confirmed.value || busy.value) return;
    const current = generation; const uid = app.auth.identity.value?.uid; busy.value = true; message.value = '';
    try {
      const destination = await action(() => active && current === generation && app.auth.phase.value === 'authenticated' && app.auth.identity.value?.uid === uid);
      if (!active || current !== generation || app.auth.phase.value !== 'authenticated' || app.auth.identity.value?.uid !== uid) return;
      if (destination) enterPage(destination);
    } catch (error) {
      if (!active || current !== generation) return;
      if (app.auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
      else if (app.auth.identity.value?.uid === uid) {
        if (['FAMILY_REQUIRED', 'FORBIDDEN', 'CONFLICT', 'NOT_FOUND'].includes(errorCode(error))) await check();
        else if (kind === 'members') confirmed.value = false;
        if (active && app.auth.identity.value?.uid === uid) showError(error);
      }
    } finally { if (current === generation) busy.value = false; }
  }
  async function signOut() {
    const current = ++generation; confirmed.value = false; message.value = '';
    await app.auth.signOut().catch(() => {});
    if (active && current === generation && app.auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
  }
  function conceal() {
    const wasActive = active; active = false; generation++; confirmed.value = false; busy.value = false; message.value = '';
    if (wasActive) { app.invitations.conceal(); app.membership.conceal(); }
  }
  onShow(check); onHide(conceal); onUnload(() => { conceal(); stop(); });
  return { ...app, confirmed, busy, message, check, act, signOut, showError, backHome: () => uni.switchTab({ url: '/pages/family/home' }) };
}
