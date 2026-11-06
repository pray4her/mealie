import type { FamilyView } from 'home-contracts';
import type { TransactionPort } from 'home-kernel';
import { AppError } from 'home-kernel';
import { familyRecord, memberRecord } from './model';

export async function readFamily(tx: TransactionPort, uid: string): Promise<FamilyView | null> {
  const value = await tx.get('family_members', uid);
  if (value === null) return null;
  const member = memberRecord(value);
  const family = familyRecord(await tx.get('families', member.familyId));
  if (member._id !== uid || family._id !== member.familyId || (family.ownerUid === uid) !== (member.role === 'owner')) throw new AppError('FAMILY_REQUIRED');
  const owner = family.ownerUid === uid ? member : memberRecord(await tx.get('family_members', family.ownerUid));
  if (owner._id !== family.ownerUid || owner.familyId !== family._id || owner.role !== 'owner') throw new AppError('FAMILY_REQUIRED');
  return { uid, familyId: family._id, role: member.role, generation: member.generation, name: family.name };
}
