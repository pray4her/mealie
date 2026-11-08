import type { FamilyContext } from 'home-contracts';
import { AppError } from 'home-kernel';

export interface InvitationRecord {
  _id: string; familyId: string; creatorUid: string; creatorGeneration: string; keyVersion: string; tokenHash: string;
  createdAt: number; expiresAt: number; status: 'pending' | 'used' | 'revoked';
  usedByUid?: string; usedAt?: number; revokedAt?: number;
}
export interface InvitationReceipt {
  _id: string; uid: string; operation: 'family-invite-v1' | 'family-revoke-v1' | 'family-join-v1';
  requestId: string; payloadHash: string; familyId: string; generation: string;
  result: { invitationId: string } | FamilyContext | Record<string, never>; createdAt: number;
}
const text = (value: unknown): value is string => typeof value === 'string' && !!value;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function invitationRecord(value: unknown): InvitationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVITATION_INVALID');
  const row = value as Record<string, unknown>;
  const keys = ['_id', 'familyId', 'creatorUid', 'creatorGeneration', 'keyVersion', 'tokenHash', 'createdAt', 'expiresAt', 'status'];
  if (Object.keys(row).some(key => ![...keys, 'usedByUid', 'usedAt', 'revokedAt'].includes(key)) || keys.some(key => !Object.hasOwn(row, key))
    || !text(row._id) || !/^[a-f0-9]{32}$/.test(row._id) || !text(row.familyId) || !text(row.creatorUid) || !text(row.creatorGeneration)
    || !text(row.keyVersion) || !/^[A-Za-z0-9_-]{1,32}$/.test(row.keyVersion) || !text(row.tokenHash) || !/^[a-f0-9]{64}$/.test(row.tokenHash)
    || !time(row.createdAt) || !time(row.expiresAt) || row.expiresAt - row.createdAt !== 86_400_000
    || !['pending', 'used', 'revoked'].includes(String(row.status))
    || (row.status === 'used' ? !text(row.usedByUid) || !time(row.usedAt) || row.usedAt < row.createdAt || row.usedAt >= row.expiresAt || 'revokedAt' in row : 'usedByUid' in row || 'usedAt' in row)
    || (row.status === 'revoked' ? !time(row.revokedAt) || row.revokedAt < row.createdAt : 'revokedAt' in row)) throw new AppError('INVITATION_INVALID');
  return row as unknown as InvitationRecord;
}
export function invitationReceipt(value: unknown): InvitationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('UNAVAILABLE');
  const row = value as Record<string, unknown>;
  const keys = ['_id', 'uid', 'operation', 'requestId', 'payloadHash', 'familyId', 'generation', 'result', 'createdAt'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))
    || !['_id', 'uid', 'requestId', 'familyId', 'generation'].every(key => text(row[key]))
    || !['family-invite-v1', 'family-revoke-v1', 'family-join-v1'].includes(String(row.operation))
    || !text(row.payloadHash) || !/^[a-f0-9]{64}$/.test(row.payloadHash) || !time(row.createdAt)) throw new AppError('UNAVAILABLE');
  if (row.operation === 'family-revoke-v1') { if (!row.result || typeof row.result !== 'object' || Array.isArray(row.result) || Object.keys(row.result).length) throw new AppError('UNAVAILABLE'); }
  else {
    if (!row.result || typeof row.result !== 'object' || Array.isArray(row.result)) throw new AppError('UNAVAILABLE');
    const result = row.result as Record<string, unknown>;
    if (row.operation === 'family-invite-v1') {
      if (Object.keys(result).length !== 1 || !text(result.invitationId)) throw new AppError('UNAVAILABLE');
    } else if (Object.keys(result).length !== 4 || !text(result.uid) || !text(result.familyId) || !text(result.generation) || result.role !== 'member') throw new AppError('UNAVAILABLE');
  }
  return row as unknown as InvitationReceipt;
}
