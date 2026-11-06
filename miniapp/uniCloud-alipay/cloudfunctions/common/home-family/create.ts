import type { FamilyView, Identity, Mutation } from 'home-contracts';
import { AppError, DatabaseFault, consumeRequestLimit, familyCreatePayloadHash, familyCreateReceiptId } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import type { FamilyDeps } from './index';
import type { CreationReceipt, FamilyRecord, MemberRecord } from './model';
import { creationReceipt } from './model';
import { readFamily } from './repository';
import { validateCreationInput } from './validation';

async function findCreation(tx: TransactionPort, uid: string, requestId: string, name: string): Promise<FamilyView | null> {
  const id = familyCreateReceiptId(uid, requestId);
  const value = await tx.get('mutation_receipts', id);
  if (value === null) {
    if (await readFamily(tx, uid)) throw new AppError('ALREADY_IN_FAMILY');
    return null;
  }
  const receipt = creationReceipt(value);
  if (familyCreatePayloadHash(receipt.result.name) !== receipt.payloadHash) throw new AppError('UNAVAILABLE');
  if (receipt._id !== id || receipt.uid !== uid || receipt.requestId !== requestId || receipt.payloadHash !== familyCreatePayloadHash(name)) throw new AppError('CONFLICT');
  const current = await readFamily(tx, uid);
  if (!current) throw new AppError('FAMILY_REQUIRED');
  if (receipt.result.uid !== uid || receipt.result.familyId !== current.familyId || receipt.result.role !== current.role || receipt.result.generation !== current.generation) throw new AppError('CONFLICT');
  return receipt.result;
}

export async function createFamily(deps: FamilyDeps, identity: Identity, input: Mutation & { name: string }): Promise<FamilyView> {
  input = validateCreationInput(input);
  const { name } = input;
  await consumeRequestLimit(deps.database, { subject: `uid:${identity.uid}`, operation: 'family:create', now: deps.now(), max: 10 });
  const replay = await deps.database.transaction(tx => findCreation(tx, identity.uid, input.requestId, name));
  if (replay) return replay;
  if (await deps.content.checkText(name) !== 'allowed') throw new AppError('INVALID_INPUT');
  await deps.revalidateIdentity();
  const familyId = deps.newId(); const generation = deps.newId(); const timestamp = deps.now();
  const result: FamilyView = { uid: identity.uid, familyId, role: 'owner', generation, name };
  const family: FamilyRecord = { _id: familyId, name, ownerUid: identity.uid, status: 'active', version: 1, createdAt: timestamp, updatedAt: timestamp };
  const member: MemberRecord = { _id: identity.uid, familyId, role: 'owner', generation, mutationSeq: 0, joinedAt: timestamp, updatedAt: timestamp };
  const receipt: CreationReceipt = { _id: familyCreateReceiptId(identity.uid, input.requestId), uid: identity.uid, operation: 'family-create-v1', requestId: input.requestId, payloadHash: familyCreatePayloadHash(name), result, createdAt: timestamp };
  try {
    return await deps.database.transaction(async tx => {
      const previous = await findCreation(tx, identity.uid, input.requestId, name);
      if (previous) return previous;
      await tx.insert('families', familyId, family);
      await tx.insert('family_members', identity.uid, member);
      await tx.insert('mutation_receipts', receipt._id, receipt);
      return result;
    });
  } catch (error) {
    if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
    const recovered = await deps.database.transaction(tx => findCreation(tx, identity.uid, input.requestId, name));
    if (!recovered) throw new AppError('UNAVAILABLE');
    return recovered;
  }
}
