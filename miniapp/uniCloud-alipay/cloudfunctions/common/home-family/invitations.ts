import { createHash } from 'node:crypto';
import type { FamilyContext, FamilyView, Identity, Invitation, Mutation } from 'home-contracts';
import { AppError, consumeRequestLimit, DatabaseFault } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import type { FamilyDeps } from './index';
import { readFamily } from './repository';
import { guardMutation } from './membership';
import { familyRecord } from './model';
import type { MemberRecord } from './model';
import { invitationRecord, invitationReceipt } from './invitation-model';
import type { InvitationReceipt, InvitationRecord } from './invitation-model';
import { parseInvitationToken, tokenHash } from './invitation-token';

const digest = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
type Operation = InvitationReceipt['operation'];
export function invitationInput(value: unknown, field?: 'token' | 'invitationId'): Mutation & Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== (field ? 2 : 1) || !Object.hasOwn(row, 'requestId') || typeof row.requestId !== 'string'
    || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)
    || (field && (!Object.hasOwn(row, field) || typeof row[field] !== 'string'))) throw new AppError('INVALID_INPUT');
  if (field === 'token') parseInvitationToken(row.token);
  if (field === 'invitationId' && !/^[a-f0-9]{32}$/.test(row.invitationId as string)) throw new AppError('INVALID_INPUT');
  return row as Mutation & Record<string, string>;
}
export async function ownerIn(tx: TransactionPort, uid: string): Promise<FamilyView> {
  const current = await readFamily(tx, uid);
  if (!current) throw new AppError('FAMILY_REQUIRED');
  if (current.role !== 'owner') throw new AppError('FORBIDDEN');
  return current;
}
async function limit(deps: FamilyDeps, uid: string, operation: string, familyId?: string) {
  await consumeRequestLimit(deps.database, { subject: `uid:${uid}`, operation, now: deps.now(), max: 10 });
  if (familyId) await consumeRequestLimit(deps.database, { subject: `family:${familyId}`, operation, now: deps.now(), max: 30 });
}
async function receiptIn(tx: TransactionPort, uid: string, operation: Operation, requestId: string, payloadHash: string): Promise<InvitationReceipt | null> {
  const id = digest([operation, uid, requestId]); const value = await tx.get('mutation_receipts', id);
  if (value === null) return null;
  const receipt = invitationReceipt(value);
  if (receipt._id !== id || receipt.uid !== uid || receipt.operation !== operation || receipt.requestId !== requestId || receipt.payloadHash !== payloadHash) throw new AppError('CONFLICT');
  const current = await readFamily(tx, uid);
  if (!current) throw new AppError('FAMILY_REQUIRED');
  if (current.familyId !== receipt.familyId || current.generation !== receipt.generation || current.role !== (operation === 'family-join-v1' ? 'member' : 'owner')) throw new AppError('CONFLICT');
  if (operation === 'family-join-v1') {
    const result = receipt.result as FamilyContext;
    if (result.uid !== uid || result.familyId !== current.familyId || result.generation !== current.generation) throw new AppError('UNAVAILABLE');
  }
  return receipt;
}
async function saveReceipt(tx: TransactionPort, ctx: FamilyContext, operation: Operation, requestId: string, payloadHash: string, result: InvitationReceipt['result'], timestamp: number) {
  const receipt: InvitationReceipt = { _id: digest([operation, ctx.uid, requestId]), uid: ctx.uid, operation, requestId, payloadHash, familyId: ctx.familyId, generation: ctx.generation, result, createdAt: timestamp };
  await tx.insert('mutation_receipts', receipt._id, receipt);
}
async function withRecovery<T>(deps: FamilyDeps, write: (tx: TransactionPort) => Promise<T>, recover: (tx: TransactionPort) => Promise<T | null>): Promise<T> {
  try { return await deps.database.transaction(write); }
  catch (error) {
    if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error;
    const result = await deps.database.transaction(recover);
    if (result === null) throw new AppError('UNAVAILABLE');
    return result;
  }
}
function activeInvite(row: InvitationRecord, owner: FamilyContext, timestamp: number): void {
  if (row.familyId !== owner.familyId || row.creatorUid !== owner.uid || row.creatorGeneration !== owner.generation || row.status !== 'pending' || timestamp >= row.expiresAt) throw new AppError('INVITATION_INVALID');
}

export async function inviteMember(deps: FamilyDeps, identity: Identity, value: Mutation): Promise<Invitation> {
  const input = invitationInput(value); const ctx = await deps.database.transaction(tx => ownerIn(tx, identity.uid));
  await limit(deps, identity.uid, 'family:invite', ctx.familyId);
  const tokens = deps.invitationTokens;
  if (!tokens) throw new AppError('UNAVAILABLE');
  const hash = digest(['family-invite-v1', ctx.familyId, ctx.generation]);
  async function replay(tx: TransactionPort): Promise<Invitation | null> {
    await ownerIn(tx, identity.uid);
    const receipt = await receiptIn(tx, identity.uid, 'family-invite-v1', input.requestId, hash);
    if (!receipt) return null;
    const id = (receipt.result as { invitationId: string }).invitationId;
    const row = invitationRecord(await tx.get('family_invitations', id));
    if (row._id !== id) throw new AppError('UNAVAILABLE');
    activeInvite(row, ctx, deps.now());
    const token = tokens!.derive(row.keyVersion, row._id);
    if (tokenHash(token) !== row.tokenHash) throw new AppError('UNAVAILABLE');
    return { invitationId: row._id, token, expiresAt: row.expiresAt };
  }
  const id = deps.newId(); const keyVersion = tokens.currentVersion(); const token = tokens.derive(keyVersion, id);
  return withRecovery(deps, async tx => {
    const previous = await replay(tx); if (previous) return previous;
    await guardMutation(tx, ctx);
    const timestamp = deps.now();
    const row: InvitationRecord = { _id: id, familyId: ctx.familyId, creatorUid: ctx.uid, creatorGeneration: ctx.generation, keyVersion, tokenHash: tokenHash(token), createdAt: timestamp, expiresAt: timestamp + 86_400_000, status: 'pending' };
    await tx.insert('family_invitations', id, row);
    await saveReceipt(tx, ctx, 'family-invite-v1', input.requestId, hash, { invitationId: id }, timestamp);
    return { invitationId: id, token, expiresAt: row.expiresAt };
  }, replay);
}

export async function revokeInvitation(deps: FamilyDeps, identity: Identity, value: Mutation & { invitationId: string }): Promise<void> {
  const input = invitationInput(value, 'invitationId'); const ctx = await deps.database.transaction(tx => ownerIn(tx, identity.uid));
  await limit(deps, identity.uid, 'family:revoke-invite', ctx.familyId);
  const hash = digest(['family-revoke-v1', ctx.familyId, ctx.generation, input.invitationId]);
  async function replay(tx: TransactionPort): Promise<true | null> {
    await ownerIn(tx, identity.uid);
    return await receiptIn(tx, identity.uid, 'family-revoke-v1', input.requestId, hash) ? true : null;
  }
  await withRecovery(deps, async tx => {
    if (await replay(tx)) return true;
    await guardMutation(tx, ctx);
    const value = await tx.get<InvitationRecord>('family_invitations', input.invitationId);
    if (!value || value.familyId !== ctx.familyId) throw new AppError('NOT_FOUND');
    const row = invitationRecord(value); if (row._id !== input.invitationId) throw new AppError('NOT_FOUND');
    if (row.status === 'used') throw new AppError('CONFLICT');
    const timestamp = deps.now();
    if (row.status !== 'revoked') await tx.replace('family_invitations', row._id, { ...row, status: 'revoked', revokedAt: timestamp });
    await saveReceipt(tx, ctx, 'family-revoke-v1', input.requestId, hash, {}, timestamp);
    return true;
  }, replay);
}

export async function joinFamily(deps: FamilyDeps, identity: Identity, value: Mutation & { token: string }): Promise<FamilyContext> {
  const input = invitationInput(value, 'token');
  await limit(deps, identity.uid, 'family:join');
  const hash = digest(['family-join-v1', tokenHash(input.token)]);
  const replay = async (tx: TransactionPort) => (await receiptIn(tx, identity.uid, 'family-join-v1', input.requestId, hash))?.result as FamilyContext | null ?? null;
  const generation = deps.newId();
  return withRecovery(deps, async tx => {
    const previous = await replay(tx); if (previous) return previous;
    if (await readFamily(tx, identity.uid)) throw new AppError('ALREADY_IN_FAMILY');
    if (!deps.invitationTokens) throw new AppError('UNAVAILABLE');
    const parsed = deps.invitationTokens.verify(input.token);
    const row = invitationRecord(await tx.get('family_invitations', parsed.id));
    if (row._id !== parsed.id || row.keyVersion !== parsed.version || row.tokenHash !== tokenHash(input.token)) throw new AppError('INVITATION_INVALID');
    let owner: FamilyView;
    try { owner = await ownerIn(tx, row.creatorUid); }
    catch (error) {
      if (error instanceof AppError && (error.code === 'FAMILY_REQUIRED' || error.code === 'FORBIDDEN')) throw new AppError('INVITATION_INVALID');
      throw error;
    }
    const timestamp = deps.now(); activeInvite(row, owner, timestamp);
    const family = familyRecord(await tx.get('families', row.familyId));
    if (family.version === Number.MAX_SAFE_INTEGER) throw new AppError('UNAVAILABLE');
    const result: FamilyContext = { uid: identity.uid, familyId: row.familyId, role: 'member', generation };
    const member: MemberRecord = { _id: identity.uid, familyId: row.familyId, role: 'member', generation, mutationSeq: 0, joinedAt: timestamp, updatedAt: timestamp };
    await tx.insert('family_members', identity.uid, member);
    await tx.replace('family_invitations', row._id, { ...row, status: 'used', usedByUid: identity.uid, usedAt: timestamp });
    await tx.replace('families', family._id, { ...family, version: family.version + 1, updatedAt: timestamp });
    await saveReceipt(tx, result, 'family-join-v1', input.requestId, hash, result, timestamp);
    return result;
  }, replay);
}
