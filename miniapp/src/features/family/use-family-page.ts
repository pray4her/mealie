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
  function showError(error: unknown) { message.value = copy.invitationErrors[errorCode(error)]; }
  async function check() {
    const current = ++generation; active = true; confirmed.value = false; message.value = ''; busy.value = false;
    try {
      await app.family.load();
      if (!active || current !== generation) return;
      if (app.auth.phase.value === 'anonymous') { uni.reLaunch({ url: '/pages/account/login' }); return; }
      if (app.auth.phase.value !== 'authenticated' || app.family.phase.value !== 'ready') throw new AppError('UNAVAILABLE');
      const view = app.family.view.value;
      if (kind !== 'join' && !view) { uni.reLaunch({ url: '/pages/family/onboarding' }); return; }
      if (kind === 'invite' && view?.role !== 'owner') throw new AppError('FORBIDDEN');
      if (kind === 'invite') await app.invitations.list();
      if (kind === 'members') await app.invitations.loadMembers();
      if (kind === 'join') app.invitations.restoreJoin();
      if (active && current === generation && app.auth.phase.value === 'authenticated') confirmed.value = true;
    } catch (error) {
      if (!active || current !== generation) return;
      if (app.auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
      else showError(error);
    }
  }
  async function act(action: () => Promise<string | void>) {
    if (!confirmed.value || busy.value) return;
    const current = generation; const uid = app.auth.identity.value?.uid; busy.value = true; message.value = '';
    try {
      const destination = await action();
      if (!active || current !== generation || app.auth.phase.value !== 'authenticated' || app.auth.identity.value?.uid !== uid) return;
      if (destination) uni.reLaunch({ url: destination });
    } catch (error) {
      if (!active || current !== generation) return;
      if (app.auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
      else if (app.auth.identity.value?.uid === uid) showError(error);
    } finally { if (current === generation) busy.value = false; }
  }
  async function signOut() {
    const current = ++generation; confirmed.value = false; message.value = '';
    await app.auth.signOut().catch(() => {});
    if (active && current === generation && app.auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
  }
  function conceal() {
    const wasActive = active; active = false; generation++; confirmed.value = false; busy.value = false; message.value = '';
    if (wasActive) app.invitations.conceal();
  }
  onShow(check); onHide(conceal); onUnload(() => { conceal(); stop(); });
  return { ...app, confirmed, busy, message, check, act, signOut, showError, backHome: () => uni.reLaunch({ url: '/pages/family/home' }) };
}
