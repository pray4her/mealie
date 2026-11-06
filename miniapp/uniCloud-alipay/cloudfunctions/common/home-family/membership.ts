import type { FamilyContext, Identity } from 'home-contracts';
import type { DatabasePort, TransactionPort } from 'home-kernel';
import { AppError } from 'home-kernel';
import { memberRecord } from './model';
import { readFamily } from './repository';

export async function requireFamily(database: DatabasePort, identity: Identity): Promise<FamilyContext> {
  return database.transaction(async tx => {
    const current = await readFamily(tx, identity.uid);
    if (!current) throw new AppError('FAMILY_REQUIRED');
    const { uid, familyId, role, generation } = current;
    return { uid, familyId, role, generation };
  });
}

export async function guardMutation(tx: TransactionPort, ctx: FamilyContext): Promise<void> {
  const current = await readFamily(tx, ctx.uid);
  if (!current) throw new AppError('FAMILY_REQUIRED');
  if (current.familyId !== ctx.familyId || current.role !== ctx.role || current.generation !== ctx.generation) throw new AppError('CONFLICT');
  const member = memberRecord(await tx.get('family_members', ctx.uid));
  if (member.mutationSeq === Number.MAX_SAFE_INTEGER) throw new AppError('CONFLICT');
  await tx.replace('family_members', ctx.uid, { ...member, mutationSeq: member.mutationSeq + 1 });
}
