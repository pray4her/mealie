import type { MemberMutation, MembershipMutation } from 'home-contracts';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError } from '../../shared/errors';
import { exactObject } from './invitation-validation';
import { membershipInput } from './membership-validation';

export type MembershipIntent = { action: 'leave'; input: MembershipMutation } | { action: 'removeMember' | 'transferOwner'; input: MemberMutation };
export function createMembershipIntents(storage: SessionStorage) {
  const key = (uid: string) => { if (!uid.trim()) throw new AppError('AUTH_REQUIRED'); return `home.family.membership.v1:${encodeURIComponent(uid)}`; };
  function parse(value: unknown): MembershipIntent {
    try {
      const row = exactObject(value, ['action', 'input']);
      if (row.action !== 'leave' && row.action !== 'removeMember' && row.action !== 'transferOwner') throw new Error();
      return { action: row.action, input: { ...membershipInput(row.action, row.input) } } as MembershipIntent;
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  return {
    read(uid: string): MembershipIntent | null { const value = storage.get(key(uid)); return value === undefined || value === null || value === '' ? null : parse(value); },
    write(uid: string, value: MembershipIntent) { storage.set(key(uid), parse(value)); },
    clear(uid: string) { storage.remove(key(uid)); },
  };
}
