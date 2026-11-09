import type { MemberMutation, MembershipMutation } from 'home-contracts';
import { AppError } from '../../shared/errors';
import { exactObject } from './invitation-validation';
import { validRequestId } from './validation';

export type MembershipAction = 'leave' | 'removeMember' | 'transferOwner';
export function membershipInput(action: MembershipAction, value: unknown): MembershipMutation | MemberMutation {
  try {
    const keys = action === 'leave' ? ['requestId', 'familyId', 'generation'] : ['requestId', 'familyId', 'generation', 'uid', 'targetGeneration'];
    const row = exactObject(value, keys);
    if (!validRequestId(row.requestId) || keys.some(key => typeof row[key] !== 'string' || !row[key] || row[key].length > 128 || row[key].trim() !== row[key] || /\p{Cc}/u.test(row[key]))) throw new Error();
    return row as MembershipMutation | MemberMutation;
  } catch { throw new AppError('INVALID_INPUT'); }
}
