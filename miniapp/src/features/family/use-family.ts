import { readonly, ref, watch } from 'vue';
import type { AccountApi, FamilyApi, FamilyView } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyIntentStore, PendingIntent } from './intents';
import { normalizeFamilyName } from './validation';
import { AppError, errorCode } from '../../shared/errors';
import { observeAccountClosure } from '../auth/api';

export type FamilyPhase = 'idle' | 'checking' | 'ready' | 'submitting' | 'unavailable' | 'conflict';
export function createFamilyController({ api, auth, account, intents, newRequestId, hasPendingJoin }: {
  api: FamilyApi; auth: AuthController; account: AccountApi;
  intents: ReturnType<typeof createFamilyIntentStore>; newRequestId: () => Promise<string>;
  hasPendingJoin?: (uid: string) => boolean;
}) {
  const view = ref<FamilyView | null>(null); const phase = ref<FamilyPhase>('idle'); const pending = ref<PendingIntent | null>(null);
  let inFlight: Promise<FamilyView> | null = null;
  let disposed = false;
  let generation = 0; let trustedUid: string | null = auth.identity.value?.uid ?? null;
  function conceal() { generation++; view.value = null; pending.value = null; phase.value = 'idle'; inFlight = null; }
  function forgetAccount() {
    const previousUid = trustedUid; trustedUid = null; conceal();
    if (previousUid) { try { intents.clear(previousUid); } catch { /* Protected state stays hidden when device storage fails. */ } }
  }
  const unobserve = observeAccountClosure(account, closing => { if (closing) forgetAccount(); });
  const stop = watch([auth.phase, () => auth.identity.value?.uid], ([authPhase, uid], [previousPhase]) => {
    if (authPhase === 'signing-out' || authPhase === 'anonymous') {
      forgetAccount();
    } else if (authPhase === 'checking' || authPhase === 'authenticating') {
      if (authPhase !== previousPhase) conceal();
    } else if (authPhase === 'unavailable') {
      view.value = null; phase.value = 'unavailable';
    } else if (authPhase === 'authenticated' && uid) {
      if (trustedUid && uid !== trustedUid) {
        intents.clear(trustedUid);
        if (previousPhase !== 'checking' && previousPhase !== 'authenticating') conceal();
      }
      trustedUid = uid;
    }
  }, { flush: 'sync' });
  const active = (uid: string, current: number) => !disposed && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid;
  const controller = {
    view: readonly(view), phase: readonly(phase), pending: readonly(pending),
    async load(): Promise<FamilyView | null> {
      if (disposed) throw new AppError('UNAVAILABLE');
      const restore = auth.restore(); const current = ++generation;
      phase.value = 'checking'; view.value = null; pending.value = null;
      if (!await restore) { if (current === generation) phase.value = 'unavailable'; return null; }
      if (current !== generation) return null;
      const uid = auth.identity.value!.uid;
      try {
        const family = await api.current();
        if (!active(uid, current)) return null;
        if (family && family.uid !== uid) throw new AppError('UNAVAILABLE');
        view.value = family;
        if (view.value) { intents.clear(uid); pending.value = null; } else pending.value = intents.read(uid);
        phase.value = 'ready'; return view.value;
      } catch (error) {
        if (!active(uid, current)) return null;
        const code = errorCode(error);
        if (code === 'AUTH_REQUIRED') await auth.signOut().catch(() => {});
        else { view.value = null; phase.value = 'unavailable'; }
        throw new AppError(code);
      }
    },
    submit(name: string): Promise<FamilyView> {
      if (disposed) return Promise.reject(new AppError('UNAVAILABLE'));
      if (inFlight) return inFlight;
      const uid = auth.identity.value?.uid; const current = generation;
      if (!uid || auth.phase.value !== 'authenticated') return Promise.reject(new AppError('AUTH_REQUIRED'));
      const wasReady = phase.value === 'ready';
      phase.value = 'submitting';
      // Install single-flight before the first random callback can be awaited.
      inFlight = Promise.resolve().then(async () => {
        let wasUncertain = true;
        try {
          if (!active(uid, current)) throw new AppError('AUTH_REQUIRED');
          if (hasPendingJoin?.(uid)) throw new AppError('CONFLICT');
          const original = pending.value ?? intents.read(uid); wasUncertain = original?.uncertain === true;
          const intent = { ...(original ?? { requestId: await newRequestId(), name: normalizeFamilyName(name) }), uncertain: true };
          if (!active(uid, current)) throw new AppError('AUTH_REQUIRED');
          intents.write(uid, intent); pending.value = intent; phase.value = 'submitting';
          let family: FamilyView;
          try { family = await api.create({ requestId: intent.requestId, name: intent.name }); }
          catch (error) {
            if (errorCode(error) !== 'ALREADY_IN_FAMILY' || !active(uid, current)) throw error;
            const existing = await api.current();
            if (!existing) throw new AppError('UNAVAILABLE');
            family = existing;
          }
          if (!active(uid, current)) throw new AppError('AUTH_REQUIRED');
          if (family.uid !== uid) throw new AppError('UNAVAILABLE');
          intents.clear(uid); pending.value = null; view.value = family; phase.value = 'ready'; return family;
        } catch (error) {
          if (!active(uid, current)) throw new AppError('AUTH_REQUIRED');
          const code = errorCode(error);
          if (code === 'AUTH_REQUIRED') { await auth.signOut().catch(() => {}); throw new AppError(code); }
          if (code === 'INVALID_INPUT' && !wasUncertain) { intents.clear(uid); pending.value = null; phase.value = wasReady ? 'ready' : 'unavailable'; }
          else phase.value = code === 'CONFLICT' ? 'conflict' : 'unavailable';
          throw new AppError(code);
        }
      }).finally(() => { if (inFlight === attempt) inFlight = null; });
      const attempt = inFlight;
      return inFlight;
    },
    retry(): Promise<FamilyView> { return pending.value ? controller.submit(pending.value.name) : Promise.reject(new AppError('INVALID_INPUT')); },
    clear: conceal,
    dispose() { disposed = true; stop(); unobserve(); conceal(); },
  }; return controller;
}
