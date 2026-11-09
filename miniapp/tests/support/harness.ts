import type { AccountStatusPort, AppClient, FamilyApi, Id, TokenPort, VerifiedToken } from 'home-contracts';
import { AppError, createRequireIdentity } from 'home-kernel';
import type { ContentPort } from 'home-kernel';
import { clientInfo } from './fixtures';
import { createMemoryDatabase } from './memory-database';
import { createFamilyService, createInvitationTokens } from 'home-family';
import type { InvitationCursor } from '../../uniCloud-alipay/cloudfunctions/common/home-family/family-reads';
import type { InvitationRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-family/invitation-model';
import type { MemberRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-family/model';

export function createHarness(options: { now?: number; content?: ContentPort; invitationEnvironment?: () => { FAMILY_INVITATION_KEY_VERSION?: string; FAMILY_INVITATION_KEYS?: string } } = {}) {
  let now = options.now ?? 1_800_000_000_000;
  const memory = createMemoryDatabase();
  let nextId = 0;
  const nicknames = new Map<string, string>();
  const records = new Map<string, NonNullable<Awaited<ReturnType<AccountStatusPort['get']>>>>();
  const verified = new Map<string, VerifiedToken>();
  let refreshCalls = 0;
  const tokenFor = (uid: string) => `fixture-${uid}`;
  const tokens: TokenPort = {
    async verify(token) {
      const result = verified.get(token);
      if (!result) throw new AppError('AUTH_REQUIRED');
      return result;
    },
    async refreshIfNeeded() { refreshCalls++; return null; },
  };
  const guard = createRequireIdentity({ tokens, accounts: { async get(uid) { return records.get(uid) ?? null; } }, now: () => now });
  const family = (uid: Id): FamilyApi => {
    const service = async () => createFamilyService({
      database: memory.database, now: () => now, newId: () => (++nextId).toString(16).padStart(32, '0'),
      invitationTokens: createInvitationTokens(options.invitationEnvironment ?? (() => ({ FAMILY_INVITATION_KEY_VERSION: 'test', FAMILY_INVITATION_KEYS: JSON.stringify({ test: '01'.repeat(32) }) }))),
      familyReads: {
        async invitations(familyId: string, after?: InvitationCursor) {
          return (await memory.rows<InvitationRecord>('family_invitations')).filter(row => row.familyId === familyId && (!after || row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row._id < after.id)))
            .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1)).slice(0, 21);
        },
        async members(familyId: string, afterUid?: string) { return (await memory.rows<MemberRecord>('family_members')).filter(row => row.familyId === familyId && (!afterUid || row._id > afterUid)).sort((a, b) => a._id < b._id ? -1 : 1).slice(0, 100); },
        async nicknames(uids: string[]) { return Object.fromEntries(uids.filter(uid => nicknames.has(uid)).map(uid => [uid, nicknames.get(uid)!])); },
      },
      content: options.content ?? { async checkText() { return 'allowed'; } },
      async revalidateIdentity() { await guard(tokenFor(uid), clientInfo, { refresh: false }); },
    }, await guard(tokenFor(uid), clientInfo));
    return {
      async current() { return (await service()).current(); }, async create(input) { return (await service()).create(input); },
      async invite(input) { return (await service()).invite(input); }, async revokeInvite(input) { return (await service()).revokeInvite(input); },
      async join(input) { return (await service()).join(input); }, async members() { return (await service()).members(); }, async invitations(input) { return (await service()).invitations(input); },
      async leave(input) { await (await service()).leave(input); }, async removeMember(input) { await (await service()).removeMember(input); }, async transferOwner(input) { return (await service()).transferOwner(input); },
    };
  };
  return {
    memory, database: memory.database,
    nickname(uid: string, value: string) { nicknames.set(uid, value); },
    family,
    async seedIdentity(input: { uid: Id; status?: number; issuedAtSeconds?: number; expiresAtSeconds?: number; validTokenDateMs?: number }) {
      records.set(input.uid, { status: input.status ?? null, tokens: [tokenFor(input.uid)], validTokenDateMs: input.validTokenDateMs ?? null });
      verified.set(tokenFor(input.uid), { uid: input.uid, issuedAtSeconds: input.issuedAtSeconds ?? Math.floor(now / 1000) - 60, expiresAtSeconds: input.expiresAtSeconds ?? Math.floor(now / 1000) + 3600 });
    },
    revokeToken(uid: Id) { const row = records.get(uid); if (row) row.tokens = []; },
    closeAccount(uid: Id) { records.delete(uid); },
    client(uid: Id): AppClient {
      return { family: family(uid), account: {
        async signInWeixin() { return guard(tokenFor(uid), clientInfo); },
        async session() { return guard(uid ? tokenFor(uid) : undefined, clientInfo); },
        async signOut() { await guard(tokenFor(uid), clientInfo, { refresh: false }); const row = records.get(uid); if (row) row.tokens = []; },
      } };
    },
    advance(ms: number) { now += ms; },
    async rows<T>(collection: string): Promise<T[]> {
      if (collection === 'families' || collection === 'family_members' || collection === 'family_invitations' || collection === 'mutation_receipts' || collection === 'request_limits') return memory.rows<T>(collection);
      if (collection !== 'uni-id-users') throw new Error('Unsupported fixture collection');
      return [...records].map(([uid, row]) => ({ uid, ...row })) as T[];
    },
    get refreshCalls() { return refreshCalls; },
  };
}
