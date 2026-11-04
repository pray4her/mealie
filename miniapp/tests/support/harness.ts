import type { AccountStatusPort, AppClient, Id, TokenPort, VerifiedToken } from 'home-contracts';
import { AppError, createRequireIdentity } from 'home-kernel';
import { clientInfo } from './fixtures';

export function createHarness(options: { now?: number } = {}) {
  let now = options.now ?? 1_800_000_000_000;
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
  return {
    async seedIdentity(input: { uid: Id; status?: number; issuedAtSeconds?: number; expiresAtSeconds?: number; validTokenDateMs?: number }) {
      records.set(input.uid, { status: input.status ?? null, tokens: [tokenFor(input.uid)], validTokenDateMs: input.validTokenDateMs ?? null });
      verified.set(tokenFor(input.uid), { uid: input.uid, issuedAtSeconds: input.issuedAtSeconds ?? now / 1000 - 60, expiresAtSeconds: input.expiresAtSeconds ?? now / 1000 + 3600 });
    },
    revokeToken(uid: Id) { const row = records.get(uid); if (row) row.tokens = []; },
    closeAccount(uid: Id) { records.delete(uid); },
    client(uid: Id): AppClient {
      return { account: {
        async signInWeixin() { return guard(tokenFor(uid), clientInfo); },
        async session() { return guard(uid ? tokenFor(uid) : undefined, clientInfo); },
        async signOut() { await guard(tokenFor(uid), clientInfo, { refresh: false }); const row = records.get(uid); if (row) row.tokens = []; },
      } };
    },
    advance(ms: number) { now += ms; },
    async rows<T>(collection: string): Promise<T[]> {
      if (collection !== 'uni-id-users') throw new Error('Unsupported fixture collection');
      return [...records].map(([uid, row]) => ({ uid, ...row })) as T[];
    },
    get refreshCalls() { return refreshCalls; },
  };
}
