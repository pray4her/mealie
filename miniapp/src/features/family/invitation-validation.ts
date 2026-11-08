import type { FamilyContext, Invitation, InvitationPage, MemberView } from 'home-contracts';
import { AppError } from '../../shared/errors';
import { validRequestId } from './validation';

export const validInvitationToken = (value: unknown): value is string => typeof value === 'string' && /^v1\.[A-Za-z0-9_-]{1,32}\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(value);
export function exactObject(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw new AppError('UNAVAILABLE');
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function mutationInput(value: unknown, field?: 'token' | 'invitationId'): void {
  let row: Record<string, unknown>;
  try { row = exactObject(value, field ? ['requestId', field] : ['requestId']); } catch { throw new AppError('INVALID_INPUT'); }
  if (!validRequestId(row.requestId)) throw new AppError('INVALID_INPUT');
  if (field === 'token' && !validInvitationToken(row.token)) throw new AppError('INVITATION_INVALID');
  if (field === 'invitationId' && (typeof row.invitationId !== 'string' || !/^[a-f0-9]{32}$/.test(row.invitationId))) throw new AppError('INVALID_INPUT');
}
export function parseInvitation(value: unknown): Invitation {
  const row = exactObject(value, ['invitationId', 'token', 'expiresAt']);
  if (!validInvitationToken(row.token) || row.token.split('.')[2] !== row.invitationId || !time(row.expiresAt)) throw new AppError('UNAVAILABLE');
  return row as Invitation;
}
export function parseJoined(value: unknown): FamilyContext {
  const row = exactObject(value, ['uid', 'familyId', 'role', 'generation']);
  if (!text(row.uid) || !text(row.familyId) || !text(row.generation) || row.role !== 'member') throw new AppError('UNAVAILABLE');
  return row as FamilyContext;
}
export function parseMembers(value: unknown): MemberView[] {
  if (!Array.isArray(value)) throw new AppError('UNAVAILABLE');
  const seen = new Set<string>();
  return value.map(item => {
    const row = exactObject(item, ['uid', 'nickname', 'role']);
    if (!text(row.uid) || seen.has(row.uid) || !text(row.nickname) || (row.role !== 'owner' && row.role !== 'member')) throw new AppError('UNAVAILABLE');
    seen.add(row.uid); return row as MemberView;
  });
}
export function parseInvitationPage(value: unknown): InvitationPage {
  const row = exactObject(value, ['items'], ['nextCursor']);
  if (!Array.isArray(row.items) || row.items.length > 20 || ('nextCursor' in row && (typeof row.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.nextCursor)))) throw new AppError('UNAVAILABLE');
  const ids = new Set<string>();
  for (const item of row.items) {
    const entry = exactObject(item, ['invitationId', 'createdAt', 'expiresAt', 'status']);
    if (typeof entry.invitationId !== 'string' || !/^[a-f0-9]{32}$/.test(entry.invitationId) || ids.has(entry.invitationId)
      || !time(entry.createdAt) || !time(entry.expiresAt) || entry.expiresAt - entry.createdAt !== 86_400_000
      || !['pending', 'used', 'revoked', 'expired'].includes(String(entry.status))) throw new AppError('UNAVAILABLE');
    ids.add(entry.invitationId);
  }
  return row as InvitationPage;
}
