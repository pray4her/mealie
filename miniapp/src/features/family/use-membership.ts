import { readonly, ref, watch } from 'vue';
import type { FamilyApi, MemberView } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from './use-family';
import type { createMembershipIntents, MembershipIntent } from './membership-intents';
import type { MembershipAction } from './membership-validation';
import { AppError, errorCode } from '../../shared/errors';

export function createMembershipController({ api, auth, family, intents, newRequestId, invalidate }: {
  api: FamilyApi; auth: AuthController; family: ReturnType<typeof createFamilyController>;
  intents: ReturnType<typeof createMembershipIntents>; newRequestId: () => Promise<string>; invalidate: () => void;
}) {
  const pending = ref<MembershipIntent | null>(null); const busy = ref(false);
  let generation = 0; let disposed = false; let trustedUid = auth.identity.value?.uid;
  let inFlight: Promise<void> | null = null;
  function conceal() { generation++; pending.value = null; busy.value = false; inFlight = null; }
  function forget() {
    const uid = trustedUid; trustedUid = undefined; conceal();
    if (uid) { try { intents.clear(uid); } catch { /* Protected state stays hidden if storage fails. */ } }
  }
  const stop = watch([auth.phase, () => auth.identity.value?.uid, auth.signOutEpoch], ([phase, uid, logout], [, , previousLogout]) => {
    if (logout !== previousLogout || ((phase === 'signing-out' || phase === 'anonymous') && trustedUid)) forget();
    else if (phase === 'authenticated' && uid) { if (trustedUid && trustedUid !== uid) forget(); trustedUid = uid; }
    else if (phase === 'checking' || phase === 'authenticating' || phase === 'unavailable') conceal();
  }, { flush: 'sync' });
  let confirmedContext: string | undefined;
  const stopFamily = watch([family.phase, family.view], ([phase, view]) => {
    if (phase !== 'ready') return;
    const context = view ? JSON.stringify([view.uid, view.familyId, view.generation, view.role]) : '';
    if (confirmedContext !== undefined && context !== confirmedContext) conceal();
    confirmedContext = context;
  }, { flush: 'sync' });
  function identity(): string {
    const uid = auth.identity.value?.uid;
    if (disposed || !uid || auth.phase.value !== 'authenticated') throw new AppError('AUTH_REQUIRED');
    return uid;
  }
  function assertActive(uid: string, epoch: number) {
    if (disposed || auth.phase.value !== 'authenticated' || auth.identity.value?.uid !== uid) throw new AppError('AUTH_REQUIRED');
    if (epoch !== generation) throw new AppError('CONFLICT');
  }
  function execute(uid: string, epoch: number, prepare: () => Promise<MembershipIntent>): Promise<void> {
    if (inFlight) return Promise.reject(new AppError('CONFLICT'));
    busy.value = true;
    const attempt = Promise.resolve().then(async () => {
      const intent = await prepare(); assertActive(uid, epoch);
      intents.write(uid, intent); pending.value = intent;
      try {
        if (intent.action === 'leave') await api.leave(intent.input);
        else if (intent.action === 'removeMember') await api.removeMember(intent.input);
        else {
          const result = await api.transferOwner(intent.input);
          if (result.uid !== uid || result.familyId !== intent.input.familyId || result.role !== 'member' || !result.generation || result.generation === intent.input.generation) throw new AppError('UNAVAILABLE');
        }
        assertActive(uid, epoch);
        intents.clear(uid); pending.value = null; invalidate();
      } catch (error) {
        assertActive(uid, epoch);
        const code = errorCode(error);
        if (code === 'AUTH_REQUIRED') await auth.signOut().catch(() => {});
        else {
          if (code !== 'UNAVAILABLE' && code !== 'QUOTA_EXCEEDED') { intents.clear(uid); pending.value = null; }
          invalidate();
          if (code === 'UNAVAILABLE' || code === 'QUOTA_EXCEEDED') family.clear('unavailable');
        }
        throw new AppError(code);
      }
    }).finally(() => { if (inFlight === attempt) { inFlight = null; busy.value = false; } });
    inFlight = attempt; return attempt;
  }
  return {
    pending: readonly(pending), busy: readonly(busy), conceal,
    run(action: MembershipAction, target?: MemberView): Promise<void> {
      const uid = identity(); const epoch = generation; const saved = intents.read(uid);
      if (saved) {
        if (saved.action !== action || (saved.action !== 'leave' && (saved.input.uid !== target?.uid || saved.input.targetGeneration !== target.generation))) return Promise.reject(new AppError('CONFLICT'));
        return execute(uid, epoch, async () => saved);
      }
      const ctx = family.view.value;
      if (!ctx || family.phase.value !== 'ready') return Promise.reject(new AppError('FAMILY_REQUIRED'));
      if ((action === 'leave') !== (ctx.role === 'member')) return Promise.reject(new AppError('FORBIDDEN'));
      if (action !== 'leave' && (!target || target.uid === uid || target.role !== 'member')) return Promise.reject(new AppError('INVALID_INPUT'));
      const expected = { familyId: ctx.familyId, generation: ctx.generation, ...(target ? { uid: target.uid, targetGeneration: target.generation } : {}) };
      return execute(uid, epoch, async () => ({ action, input: { requestId: await newRequestId(), ...expected } }) as MembershipIntent);
    },
    async resume(): Promise<boolean> {
      const uid = identity(); const epoch = generation;
      let saved: MembershipIntent | null;
      try { saved = intents.read(uid); } catch { family.clear('unavailable'); throw new AppError('UNAVAILABLE'); }
      pending.value = saved;
      if (!saved) return false;
      try { await execute(uid, epoch, async () => saved); }
      catch (error) {
        if (errorCode(error) === 'AUTH_REQUIRED' || errorCode(error) === 'UNAVAILABLE' || errorCode(error) === 'QUOTA_EXCEEDED') throw error;
        // A terminal precondition failure is reconciled using current(), never a new intent.
        assertActive(uid, epoch);
      }
      return true;
    },
    dispose() { disposed = true; stop(); stopFamily(); conceal(); },
  };
}
