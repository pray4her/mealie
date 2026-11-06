import { AppError } from 'home-kernel';
import type { FamilyView } from 'home-contracts';

export interface FamilyRecord {
  _id: string; name: string; ownerUid: string; status: 'active'; version: number; createdAt: number; updatedAt: number;
}
export interface MemberRecord {
  _id: string; familyId: string; role: 'owner' | 'member'; generation: string; mutationSeq: number; joinedAt: number; updatedAt: number;
}
export interface CreationReceipt {
  _id: string; uid: string; operation: 'family-create-v1'; requestId: string; payloadHash: string; result: FamilyView; createdAt: number;
}

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const name = (value: unknown): value is string => text(value) && value.trim() === value && [...value].length <= 40 && !/\p{Cc}/u.test(value);

export function familyRecord(value: unknown): FamilyRecord {
  if (!record(value, ['_id', 'name', 'ownerUid', 'status', 'version', 'createdAt', 'updatedAt'])
    || !text(value._id) || !name(value.name) || !text(value.ownerUid) || value.status !== 'active'
    || !counter(value.version) || value.version < 1 || !counter(value.createdAt) || !counter(value.updatedAt)) throw new AppError('FAMILY_REQUIRED');
  return value as unknown as FamilyRecord;
}

export function memberRecord(value: unknown): MemberRecord {
  if (!record(value, ['_id', 'familyId', 'role', 'generation', 'mutationSeq', 'joinedAt', 'updatedAt'])
    || !text(value._id) || !text(value.familyId) || !text(value.generation) || (value.role !== 'owner' && value.role !== 'member')
    || !counter(value.mutationSeq) || !counter(value.joinedAt) || !counter(value.updatedAt)) throw new AppError('FAMILY_REQUIRED');
  return value as unknown as MemberRecord;
}

export function creationReceipt(value: unknown): CreationReceipt {
  if (!record(value, ['_id', 'uid', 'operation', 'requestId', 'payloadHash', 'result', 'createdAt'])
    || !text(value._id) || !text(value.uid) || value.operation !== 'family-create-v1' || !text(value.requestId)
    || typeof value.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.payloadHash) || !counter(value.createdAt)
    || !record(value.result, ['uid', 'familyId', 'role', 'generation', 'name']) || !text(value.result.uid)
    || !text(value.result.familyId) || value.result.role !== 'owner' || !text(value.result.generation) || !name(value.result.name)) throw new AppError('UNAVAILABLE');
  return value as unknown as CreationReceipt;
}
