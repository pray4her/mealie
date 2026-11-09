import type { SessionStorage } from '../../shared/session-boundary';
import { AppError } from '../../shared/errors';
import { exactObject } from './invitation-validation';
import { validRequestId } from './validation';
import type { FamilyContext } from 'home-contracts';

export type InvitationIntent = { requestId: string; tokenHash?: string; invitationId?: string; familyId?: string; generation?: string };
export type InvitationOperation = 'invite' | 'join' | 'revoke';
export function createInvitationIntents(storage: SessionStorage) {
  const key = (uid: string, operation: InvitationOperation) => {
    if (!uid.trim()) throw new AppError('AUTH_REQUIRED');
    return `home.family.${operation}.v1:${encodeURIComponent(uid)}`;
  };
  function parse(value: unknown, operation: InvitationOperation): InvitationIntent {
    const row = exactObject(value, operation === 'join' ? ['requestId', 'tokenHash'] : operation === 'invite' ? ['requestId', 'familyId', 'generation'] : ['requestId', 'familyId', 'generation', 'invitationId']);
    if (!validRequestId(row.requestId) || (operation === 'join' && (typeof row.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.tokenHash)))
      || (operation !== 'join' && (typeof row.familyId !== 'string' || !row.familyId || typeof row.generation !== 'string' || !row.generation))
      || (operation === 'revoke' && (typeof row.invitationId !== 'string' || !/^[a-f0-9]{32}$/.test(row.invitationId)))) throw new AppError('UNAVAILABLE');
    return row as InvitationIntent;
  }
  function revokes(uid: string): Record<string, InvitationIntent> {
    const value: unknown = storage.get(key(uid, 'revoke'));
    if (value === undefined || value === null || value === '') return Object.create(null);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('UNAVAILABLE');
    const result: Record<string, InvitationIntent> = Object.create(null);
    for (const [id, intent] of Object.entries(value)) {
      const parsed = parse(intent, 'revoke');
      if (id !== parsed.invitationId) throw new AppError('UNAVAILABLE');
      result[id] = parsed;
    }
    return result;
  }
  return {
    read(uid: string, operation: InvitationOperation, invitationId?: string): InvitationIntent | null {
      if (operation === 'revoke') { if (!invitationId) throw new AppError('UNAVAILABLE'); return revokes(uid)[invitationId] ?? null; }
      const value = storage.get(key(uid, operation)); return value === undefined || value === null || value === '' ? null : parse(value, operation);
    },
    write(uid: string, operation: InvitationOperation, value: InvitationIntent) {
      const intent = parse(value, operation);
      storage.set(key(uid, operation), operation === 'revoke' ? { ...revokes(uid), [intent.invitationId!]: intent } : intent);
    },
    clear(uid: string, operation: InvitationOperation, invitationId?: string) {
      if (operation !== 'revoke') { storage.remove(key(uid, operation)); return; }
      if (!invitationId) throw new AppError('UNAVAILABLE');
      const remaining = revokes(uid); delete remaining[invitationId];
      if (Object.keys(remaining).length) storage.set(key(uid, operation), remaining); else storage.remove(key(uid, operation));
    },
    clearAll(uid: string) { for (const operation of ['invite', 'join', 'revoke'] as const) storage.remove(key(uid, operation)); },
    reconcile(uid: string, ctx: FamilyContext | null) {
      const matches = (intent: InvitationIntent) => ctx && intent.familyId === ctx.familyId && intent.generation === ctx.generation && ctx.role === 'owner';
      const invite = this.read(uid, 'invite');
      if (invite && !matches(invite)) storage.remove(key(uid, 'invite'));
      const remaining = Object.fromEntries(Object.entries(revokes(uid)).filter(([, intent]) => matches(intent)));
      if (Object.keys(remaining).length) storage.set(key(uid, 'revoke'), remaining); else storage.remove(key(uid, 'revoke'));
      if (ctx) storage.remove(key(uid, 'join'));
    },
  };
}
