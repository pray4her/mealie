import { createHash } from 'node:crypto';
import type { FamilyContext, FamilyView, Identity, MemberMutation, MembershipMutation } from 'home-contracts';
import { AppError, consumeRequestLimit, DatabaseFault } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import type { FamilyDeps } from './index';
import { readFamily } from './repository';
import { guardMutation } from './membership';
import { familyRecord, memberRecord } from './model';

type Action = 'leave' | 'removeMember' | 'transferOwner';
const operations = { leave: 'family-leave-v1', removeMember: 'family-remove-v1', transferOwner: 'family-transfer-v1' } as const;
type Receipt = {
  _id: string; uid: string; operation: typeof operations[Action]; requestId: string; payloadHash: string;
  familyId: string; generation: string; targetUid?: string; targetGeneration?: string;
  result: FamilyContext | Record<string, never>; createdAt: number;
};
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !/\p{Cc}/u.test(value);
const digest = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function inputFor(action: Action, value: unknown): MembershipMutation | MemberMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT');
  const row = value as Record<string, unknown>;
  const keys = action === 'leave' ? ['requestId', 'familyId', 'generation'] : ['requestId', 'familyId', 'generation', 'uid', 'targetGeneration'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key) || !text(row[key]))
    || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId as string)) throw new AppError('INVALID_INPUT');
  return row as MembershipMutation | MemberMutation;
}
function payloadHash(action: Action, input: MembershipMutation | MemberMutation): string {
  return digest([operations[action], input.familyId, input.generation, ...('uid' in input ? [input.uid, input.targetGeneration] : [])]);
}
function receiptRecord(value: unknown, action: Action): Receipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('UNAVAILABLE');
  const row = value as Record<string, unknown>;
  const keys = ['_id', 'uid', 'operation', 'requestId', 'payloadHash', 'familyId', 'generation', 'result', 'createdAt', ...(action === 'leave' ? [] : ['targetUid', 'targetGeneration'])];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))
    || !['_id', 'uid', 'requestId', 'familyId', 'generation', ...(action === 'leave' ? [] : ['targetUid', 'targetGeneration'])].every(key => text(row[key]))
    || row.operation !== operations[action] || typeof row.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadHash)
    || typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0
    || !row.result || typeof row.result !== 'object' || Array.isArray(row.result)) throw new AppError('UNAVAILABLE');
  const result = row.result as Record<string, unknown>;
  if (action === 'transferOwner' ? Object.keys(result).length !== 4 || result.uid !== row.uid || result.familyId !== row.familyId
    || result.role !== 'member' || !text(result.generation) || result.generation === row.generation : Object.keys(result).length !== 0) throw new AppError('UNAVAILABLE');
  const original = { requestId: row.requestId as string, familyId: row.familyId as string, generation: row.generation as string,
    ...(action === 'leave' ? {} : { uid: row.targetUid as string, targetGeneration: row.targetGeneration as string }) };
  if (payloadHash(action, inputFor(action, original)) !== row.payloadHash) throw new AppError('UNAVAILABLE');
  return row as Receipt;
}

async function mutate(deps: FamilyDeps, identity: Identity, action: Action, value: unknown): Promise<FamilyContext | null> {
  const input = inputFor(action, value); const operation = operations[action];
  const id = digest([operation, identity.uid, input.requestId]); const hash = payloadHash(action, input);
  async function receiptIn(tx: TransactionPort): Promise<Receipt | null> {
    const value = await tx.get('mutation_receipts', id);
    if (value === null) return null;
    const receipt = receiptRecord(value, action);
    if (receipt._id !== id || receipt.uid !== identity.uid || receipt.requestId !== input.requestId || receipt.payloadHash !== hash) throw new AppError('CONFLICT');
    return receipt;
  }
  async function replay(tx: TransactionPort, receipt: Receipt): Promise<FamilyContext | null> {
    // A leave receipt acknowledges only the old operation, never a later membership.
    if (action === 'leave') return null;
    const current = await readFamily(tx, identity.uid);
    if (!current) throw new AppError('FAMILY_REQUIRED');
    const expected = action === 'transferOwner' ? receipt.result as FamilyContext : { familyId: receipt.familyId, generation: receipt.generation, role: 'owner' };
    if (current.familyId !== expected.familyId || current.generation !== expected.generation || current.role !== expected.role) throw new AppError('CONFLICT');
    return action === 'transferOwner' ? receipt.result as FamilyContext : null;
  }
  async function actorIn(tx: TransactionPort): Promise<FamilyView> {
    const current = await readFamily(tx, identity.uid);
    if (!current) throw new AppError('FAMILY_REQUIRED');
    if (current.familyId !== input.familyId || current.generation !== input.generation) throw new AppError('CONFLICT');
    if ((action === 'leave') !== (current.role === 'member')) throw new AppError('FORBIDDEN');
    if ('uid' in input && input.uid === identity.uid) throw new AppError('INVALID_INPUT');
    return current;
  }
  await consumeRequestLimit(deps.database, { subject: `uid:${identity.uid}`, operation, now: deps.now(), max: 10 });
  const familyId = await deps.database.transaction(async tx => {
    const receipt = await receiptIn(tx);
    if (receipt) { await replay(tx, receipt); return receipt.familyId; }
    return (await actorIn(tx)).familyId;
  });
  await consumeRequestLimit(deps.database, { subject: `family:${familyId}`, operation, now: deps.now(), max: 30 });
  const actorGeneration = action === 'transferOwner' ? deps.newId() : '';
  const targetGeneration = action === 'transferOwner' ? deps.newId() : '';
  try {
    return await deps.database.transaction(async tx => {
      const previous = await receiptIn(tx); if (previous) return replay(tx, previous);
      const ctx = await actorIn(tx);
      await guardMutation(tx, ctx);
      let target: FamilyView | null = null;
      if ('uid' in input) {
        target = await readFamily(tx, input.uid);
        if (!target || target.familyId !== ctx.familyId) throw new AppError('NOT_FOUND');
        if (target.generation !== input.targetGeneration || target.role !== 'member') throw new AppError('CONFLICT');
      }
      const timestamp = deps.now(); const family = familyRecord(await tx.get('families', ctx.familyId));
      if (family.version === Number.MAX_SAFE_INTEGER) throw new AppError('CONFLICT');
      let result: FamilyContext | null = null;
      if (action === 'transferOwner' && target) {
        await guardMutation(tx, target);
        const actor = memberRecord(await tx.get('family_members', ctx.uid));
        const member = memberRecord(await tx.get('family_members', target.uid));
        await tx.replace('family_members', ctx.uid, { ...actor, role: 'member', generation: actorGeneration, updatedAt: timestamp });
        await tx.replace('family_members', target.uid, { ...member, role: 'owner', generation: targetGeneration, updatedAt: timestamp });
        result = { uid: ctx.uid, familyId: ctx.familyId, role: 'member', generation: actorGeneration };
      } else await tx.remove('family_members', target?.uid ?? ctx.uid);
      await tx.replace('families', family._id, { ...family, ...(action === 'transferOwner' ? { ownerUid: target!.uid } : {}), version: family.version + 1, updatedAt: timestamp });
      const receipt: Receipt = { _id: id, uid: identity.uid, operation, requestId: input.requestId, payloadHash: hash, familyId: ctx.familyId, generation: ctx.generation,
        ...('uid' in input ? { targetUid: input.uid, targetGeneration: input.targetGeneration } : {}), result: result ?? {}, createdAt: timestamp };
      await tx.insert('mutation_receipts', id, receipt);
      return result;
    });
  } catch (error) {
    if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
    return deps.database.transaction(async tx => {
      const receipt = await receiptIn(tx); if (!receipt) throw new AppError('UNAVAILABLE');
      return replay(tx, receipt);
    });
  }
}
export async function leaveFamily(deps: FamilyDeps, identity: Identity, input: MembershipMutation): Promise<void> { await mutate(deps, identity, 'leave', input); }
export async function removeFamilyMember(deps: FamilyDeps, identity: Identity, input: MemberMutation): Promise<void> { await mutate(deps, identity, 'removeMember', input); }
export async function transferFamilyOwner(deps: FamilyDeps, identity: Identity, input: MemberMutation): Promise<FamilyContext> {
  const result = await mutate(deps, identity, 'transferOwner', input);
  if (!result) throw new AppError('UNAVAILABLE');
  return result;
}
