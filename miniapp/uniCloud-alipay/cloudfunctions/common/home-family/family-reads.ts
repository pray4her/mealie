import type { FamilyView, Identity, InvitationPage, MemberView } from 'home-contracts';
import { AppError, consumeRequestLimit } from 'home-kernel';
import type { FamilyDeps } from './index';
import { readFamily } from './repository';
import { familyRecord, memberRecord } from './model';
import { invitationRecord } from './invitation-model';

export type InvitationCursor = { familyId: string; createdAt: number; id: string };
export interface FamilyReads {
  invitations(familyId: string, after?: InvitationCursor): Promise<unknown[]>;
  members(familyId: string, afterUid?: string): Promise<unknown[]>;
  nicknames(uids: string[]): Promise<Record<string, string>>;
}
interface Query {
  where(filter: Record<string, unknown>): Query; orderBy(field: string, direction: 'asc' | 'desc'): Query;
  limit(count: number): Query; field(projection: Record<string, boolean>): Query; get(): Promise<unknown>;
}
export interface FamilyReadPlatform {
  command: { lt(value: string | number): unknown; gt(value: string): unknown; in(values: string[]): unknown; or(values: Record<string, unknown>[]): Record<string, unknown>; and(values: Record<string, unknown>[]): Record<string, unknown> };
  collection(name: string): Query;
}
export function createFamilyReads(platform: FamilyReadPlatform): FamilyReads {
  async function rows(query: Query): Promise<unknown[]> {
    const result = await query.get();
    if (!result || typeof result !== 'object' || ('errCode' in result && result.errCode !== 0) || !('data' in result) || !Array.isArray(result.data)) throw new AppError('UNAVAILABLE');
    return result.data;
  }
  return {
    async invitations(familyId, after) {
      const cmd = platform.command;
      const filter = after ? cmd.and([{ familyId }, cmd.or([{ createdAt: cmd.lt(after.createdAt) }, { createdAt: after.createdAt, _id: cmd.lt(after.id) }])]) : { familyId };
      return rows(platform.collection('family_invitations').where(filter).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(21));
    },
    async members(familyId, afterUid) {
      return rows(platform.collection('family_members').where({ familyId, ...(afterUid ? { _id: platform.command.gt(afterUid) } : {}) }).orderBy('_id', 'asc').limit(100));
    },
    async nicknames(uids) {
      const result: Record<string, string> = Object.create(null);
      if (!uids.length) return result;
      for (const value of await rows(platform.collection('uni-id-users').where({ _id: platform.command.in(uids) }).field({ _id: true, nickname: true }).limit(100))) {
        if (!value || typeof value !== 'object' || !('_id' in value) || typeof value._id !== 'string' || !uids.includes(value._id)) throw new AppError('UNAVAILABLE');
        if ('nickname' in value && typeof value.nickname === 'string' && value.nickname.trim()) result[value._id] = value.nickname;
      }
      return result;
    },
  };
}
async function snapshot(deps: FamilyDeps, uid: string, ownerOnly: boolean) {
  return deps.database.transaction(async tx => {
    const view = await readFamily(tx, uid);
    if (!view) throw new AppError('FAMILY_REQUIRED');
    if (ownerOnly && view.role !== 'owner') throw new AppError('FORBIDDEN');
    return { view, version: familyRecord(await tx.get('families', view.familyId)).version };
  });
}
async function confirm(deps: FamilyDeps, original: { view: FamilyView; version: number }) {
  const current = await snapshot(deps, original.view.uid, false);
  if (current.view.familyId !== original.view.familyId || current.view.generation !== original.view.generation || current.view.role !== original.view.role || current.version !== original.version) throw new AppError('CONFLICT');
}
async function prepare(deps: FamilyDeps, identity: Identity, operation: string, ownerOnly: boolean) {
  const current = await snapshot(deps, identity.uid, ownerOnly);
  await consumeRequestLimit(deps.database, { subject: `uid:${identity.uid}`, operation, now: deps.now(), max: 60 });
  await consumeRequestLimit(deps.database, { subject: `family:${current.view.familyId}`, operation, now: deps.now(), max: 300 });
  if (!deps.familyReads) throw new AppError('UNAVAILABLE');
  return current;
}
function decodeCursor(value: unknown, familyId: string): InvitationCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new AppError('INVALID_INPUT');
  try {
    const cursor: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).length !== 3
      || !('familyId' in cursor) || cursor.familyId !== familyId || !('createdAt' in cursor) || typeof cursor.createdAt !== 'number' || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0
      || !('id' in cursor) || typeof cursor.id !== 'string' || !/^[a-f0-9]{32}$/.test(cursor.id)) throw new Error();
    return cursor as InvitationCursor;
  } catch { throw new AppError('INVALID_INPUT'); }
}
export async function listInvitations(deps: FamilyDeps, identity: Identity, input: { cursor?: string }): Promise<InvitationPage> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'cursor')) throw new AppError('INVALID_INPUT');
  const current = await prepare(deps, identity, 'family:invitations', true);
  const cursor = decodeCursor(input.cursor, current.view.familyId);
  const rows = (await deps.familyReads!.invitations(current.view.familyId, cursor)).map(invitationRecord);
  if (rows.length > 21 || rows.some(row => row.familyId !== current.view.familyId)) throw new AppError('UNAVAILABLE');
  const selected = rows.slice(0, 20); const last = selected.at(-1);
  const timestamp = deps.now();
  const result: InvitationPage = { items: selected.map(row => ({ invitationId: row._id, createdAt: row.createdAt, expiresAt: row.expiresAt,
    status: row.status === 'pending' && timestamp >= row.expiresAt ? 'expired' : row.status })) };
  if (rows.length > 20 && last) result.nextCursor = Buffer.from(JSON.stringify({ familyId: last.familyId, createdAt: last.createdAt, id: last._id })).toString('base64url');
  await confirm(deps, current); return result;
}
export async function listMembers(deps: FamilyDeps, identity: Identity): Promise<MemberView[]> {
  const current = await prepare(deps, identity, 'family:members', false);
  const result: MemberView[] = []; let after: string | undefined;
  for (;;) {
    const rows = (await deps.familyReads!.members(current.view.familyId, after)).map(memberRecord);
    if (rows.length > 100 || rows.some((row, index) => row.familyId !== current.view.familyId || row._id <= (index ? rows[index - 1]._id : after ?? ''))) throw new AppError('UNAVAILABLE');
    const names = await deps.familyReads!.nicknames(rows.map(row => row._id));
    result.push(...rows.map(row => ({ uid: row._id, role: row.role, nickname: names[row._id] || '家庭成员' })));
    if (rows.length < 100) break;
    after = rows[rows.length - 1]._id;
  }
  await confirm(deps, current); return result;
}
