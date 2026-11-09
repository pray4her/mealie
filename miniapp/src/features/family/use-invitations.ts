import { readonly, ref, watch } from 'vue';
import type { FamilyApi, FamilyContext, Invitation, InvitationView, MemberView } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from './use-family';
import type { createFamilyIntentStore } from './intents';
import type { createInvitationIntents, InvitationOperation } from './invitation-intents';
import { validInvitationToken } from './invitation-validation';
import { invitationDigest } from './token-digest';
import { AppError, errorCode } from '../../shared/errors';

export function createInvitationController({ api, auth, family, intents, creations, newRequestId }: {
  api: FamilyApi; auth: AuthController; family: ReturnType<typeof createFamilyController>;
  intents: ReturnType<typeof createInvitationIntents>; creations: ReturnType<typeof createFamilyIntentStore>; newRequestId: () => Promise<string>;
}) {
  const invitation = ref<Invitation | null>(null); const items = ref<InvitationView[]>([]); const members = ref<MemberView[]>([]);
  const nextCursor = ref<string>(); const token = ref(''); const pendingJoin = ref(false);
  let generation = 0; let disposed = false; let trustedUid: string | null = auth.identity.value?.uid ?? null;
  let inFlight: Promise<unknown> | null = null;
  function conceal() { generation++; invitation.value = null; items.value = []; members.value = []; nextCursor.value = undefined; inFlight = null; }
  function forget() {
    const uid = trustedUid; trustedUid = null; token.value = ''; pendingJoin.value = false; conceal();
    if (uid) { try { intents.clearAll(uid); } catch { /* Protected state stays hidden on storage failure. */ } }
  }
  const stop = watch([auth.phase, () => auth.identity.value?.uid, auth.signOutEpoch], ([phase, uid, logout], [, , previousLogout]) => {
    // A first anonymous SDK session check also closes its boundary; it is not an explicit logout.
    if (logout !== previousLogout || ((phase === 'signing-out' || phase === 'anonymous') && trustedUid)) forget();
    else if (phase === 'authenticated' && uid) {
      if (trustedUid && uid !== trustedUid) forget();
      trustedUid = uid;
    } else if (phase === 'checking' || phase === 'unavailable') conceal();
  }, { flush: 'sync' });
  const stopFamily = watch([family.phase, family.view], ([phase, view]) => {
    if (phase !== 'ready' || auth.phase.value !== 'authenticated' || !auth.identity.value?.uid) return;
    intents.reconcile(auth.identity.value.uid, view);
    if (!view) conceal();
  }, { flush: 'sync' });
  function identity() {
    const uid = auth.identity.value?.uid;
    if (disposed || !uid || auth.phase.value !== 'authenticated') throw new AppError('AUTH_REQUIRED');
    return uid;
  }
  const active = (uid: string, epoch: number) => !disposed && generation === epoch && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid;
  function ownerContext() {
    identity(); const ctx = family.view.value;
    if (!ctx || family.phase.value !== 'ready') throw new AppError('FAMILY_REQUIRED');
    if (ctx.role !== 'owner') throw new AppError('FORBIDDEN');
    return ctx;
  }
  async function failure(error: unknown): Promise<never> {
    if (errorCode(error) === 'AUTH_REQUIRED') await auth.signOut().catch(() => {});
    else if (errorCode(error) === 'FAMILY_REQUIRED' || errorCode(error) === 'FORBIDDEN') { family.clear(); conceal(); }
    throw new AppError(errorCode(error));
  }
  async function write<T>(operation: InvitationOperation, action: (uid: string, epoch: number) => Promise<T>): Promise<T> {
    if (inFlight) throw new AppError('CONFLICT');
    const uid = identity(); const epoch = generation;
    const attempt = Promise.resolve().then(() => action(uid, epoch)); inFlight = attempt;
    try { const result = await attempt; if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED'); return result; }
    catch (error) { if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED'); return failure(error); }
    finally { if (inFlight === attempt) inFlight = null; if (operation === 'join' && active(uid, epoch)) pendingJoin.value = !!intents.read(uid, 'join'); }
  }
  async function list(append = false) {
    const ctx = ownerContext(); const uid = identity(); const epoch = generation;
    try {
      const page = await api.invitations(append && nextCursor.value ? { cursor: nextCursor.value } : {});
      if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
      if (family.view.value?.generation !== ctx.generation) throw new AppError('CONFLICT');
      for (const item of page.items) if (item.status !== 'pending') intents.clear(uid, 'revoke', item.invitationId);
      items.value = append ? [...items.value, ...page.items] : page.items; nextCursor.value = page.nextCursor;
    } catch (error) { if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED'); return failure(error); }
  }
  return {
    invitation: readonly(invitation), items: readonly(items), members: readonly(members), token: readonly(token), nextCursor: readonly(nextCursor), pendingJoin: readonly(pendingJoin),
    receive(value: string) { if (!validInvitationToken(value)) throw new AppError('INVITATION_INVALID'); token.value = value; },
    hasLoginContinuation() { return validInvitationToken(token.value); },
    clearIncoming() { token.value = ''; },
    restoreJoin() {
      const uid = identity(); pendingJoin.value = !!intents.read(uid, 'join');
      if (family.view.value) { intents.clear(uid, 'join'); pendingJoin.value = false; }
    },
    list,
    async loadMembers() {
      const uid = identity(); const epoch = generation;
      try { const result = await api.members(); if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED'); members.value = result; }
      catch (error) { if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED'); return failure(error); }
    },
    generate() {
      const ctx = ownerContext();
      return write('invite', async (uid, epoch) => {
        let intent = intents.read(uid, 'invite');
        if (intent && (intent.familyId !== ctx.familyId || intent.generation !== ctx.generation)) throw new AppError('CONFLICT');
        intent ??= { requestId: await newRequestId(), familyId: ctx.familyId, generation: ctx.generation };
        if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
        intents.write(uid, 'invite', intent);
        try {
          const result = await api.invite({ requestId: intent.requestId });
          if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
          intents.clear(uid, 'invite'); invitation.value = result; return result;
        } catch (error) { if (active(uid, epoch) && errorCode(error) === 'INVITATION_INVALID') intents.clear(uid, 'invite'); throw error; }
      });
    },
    revoke(invitationId: string) {
      const ctx = ownerContext();
      return write('revoke', async (uid, epoch) => {
        let intent = intents.read(uid, 'revoke', invitationId);
        if (intent && (intent.invitationId !== invitationId || intent.familyId !== ctx.familyId || intent.generation !== ctx.generation)) throw new AppError('CONFLICT');
        intent ??= { requestId: await newRequestId(), invitationId, familyId: ctx.familyId, generation: ctx.generation };
        if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
        intents.write(uid, 'revoke', intent);
        try { await api.revokeInvite({ requestId: intent.requestId, invitationId }); }
        catch (error) { if (active(uid, epoch) && ['CONFLICT', 'NOT_FOUND'].includes(errorCode(error))) intents.clear(uid, 'revoke', invitationId); throw error; }
        if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
        intents.clear(uid, 'revoke', invitationId); if (invitation.value?.invitationId === invitationId) invitation.value = null;
      });
    },
    join(): Promise<FamilyContext> {
      return write('join', async (uid, epoch) => {
        if (!validInvitationToken(token.value)) throw new AppError('INVITATION_INVALID');
        if (creations.read(uid)) throw new AppError('CONFLICT');
        if (family.view.value) throw new AppError('ALREADY_IN_FAMILY');
        const digest = invitationDigest(token.value); const previous = intents.read(uid, 'join');
        if (previous && previous.tokenHash !== digest) throw new AppError('CONFLICT');
        const intent = previous ?? { requestId: await newRequestId(), tokenHash: digest };
        if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
        intents.write(uid, 'join', intent); pendingJoin.value = true;
        try {
          const result = await api.join({ requestId: intent.requestId, token: token.value });
          if (!active(uid, epoch)) throw new AppError('AUTH_REQUIRED');
          if (result.uid !== uid) throw new AppError('UNAVAILABLE');
          intents.clear(uid, 'join'); pendingJoin.value = false; token.value = ''; return result;
        } catch (error) {
          if (active(uid, epoch) && !previous && ['INVITATION_INVALID', 'INVALID_INPUT', 'ALREADY_IN_FAMILY'].includes(errorCode(error))) { intents.clear(uid, 'join'); pendingJoin.value = false; token.value = ''; }
          throw error;
        }
      });
    },
    conceal,
    dispose() { disposed = true; stop(); stopFamily(); token.value = ''; conceal(); },
  };
}
