import { createMediaService } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import type { MediaReviewPort, StoragePort } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import { digest } from '../../uniCloud-alipay/cloudfunctions/common/home-media/files';
import type { AccountStatusPort, AppClient, FamilyApi, Id, TokenPort, VerifiedToken } from 'home-contracts';
import { AppError, createRequireIdentity } from 'home-kernel';
import type { ContentPort } from 'home-kernel';
import { clientInfo } from './fixtures';
import { createMemoryDatabase } from './memory-database';
import { createFamilyService, createInvitationTokens } from 'home-family';
import type { InvitationCursor } from '../../uniCloud-alipay/cloudfunctions/common/home-family/family-reads';
import type { InvitationRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-family/invitation-model';
import type { MemberRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-family/model';
import { createRecipesService } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes';
import { requireFamily } from 'home-family';
import type { RecipesApi } from 'home-contracts';
import type { RecipeRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes/repository';
import { createImportsService, runImportWorker } from '../../uniCloud-alipay/cloudfunctions/common/home-imports';
import type { ImportConfig, Job, Provider } from '../../uniCloud-alipay/cloudfunctions/common/home-imports';
import { defaultConfig } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/model';

export function createHarness(options: { now?: number; content?: ContentPort; storage?: StoragePort; review?: MediaReviewPort; importsProvider?: Provider; importsConfig?: () => ImportConfig; recentlyVisited?: () => Promise<boolean>; invitationEnvironment?: () => { FAMILY_INVITATION_KEY_VERSION?: string; FAMILY_INVITATION_KEYS?: string } } = {}) {
  let now = options.now ?? 1_800_000_000_000;
  const memory = createMemoryDatabase();
  const files = new Map<string, Buffer>();
  const storage: StoragePort = options.storage ?? {
    async upload(path, bytes) { const id = 'cloud://mock/' + path; files.set(id, Buffer.from(bytes)); return id; },
    async read(id) { const bytes = files.get(id); if (!bytes) throw new AppError('NOT_FOUND'); return Buffer.from(bytes); },
    async sign(id) { if (!files.has(id)) throw new AppError('NOT_FOUND'); return { url: 'https://mock.invalid/media/' + encodeURIComponent(id) + '?expire_at=' + Math.floor((now + 600000) / 1000), expiresAt: now + 600000 }; },
  };
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
  const recipes = (uid: Id): RecipesApi => {
    const service = async () => createRecipesService({
      database: memory.database, now: () => now, newId: () => (++nextId).toString(16).padStart(32, '0'),
      content: options.content ?? { async checkText() { return 'allowed'; } },
      reads: { async list(familyId, limit, after) {
        return (await memory.rows<RecipeRecord>('recipes')).filter(row => row.familyId === familyId && (!after || row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row._id < after.id)))
          .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1)).slice(0, limit + 1)
          .map(({ _id, familyId, title, tags, createdAt }) => ({ _id, familyId, title, tags, createdAt }));
      }, async favorites(ctx, ids) {
        return (await memory.rows<import('../../uniCloud-alipay/cloudfunctions/common/home-recipes/repository').FavoriteRecord>('recipe_favorites'))
          .filter(row => row.uid === ctx.uid && row.familyId === ctx.familyId && row.generation === ctx.generation && ids.includes(row.recipeId));
      } },
      async revalidateIdentity() { await guard(tokenFor(uid), clientInfo, { refresh: false }); },
    }, await requireFamily(memory.database, await guard(tokenFor(uid), clientInfo)));
    return { async create(input) { return (await service()).create(input); }, async get(id) { return (await service()).get(id); },
      async list(input) { return (await service()).list(input); }, async update(input) { return (await service()).update(input); }, async favorite(input) { return (await service()).favorite(input); }, async bindImages(input) { return (await service()).bindImages(input); } };
  };
  const media = (uid: Id): import('home-contracts').MediaApi => {
    const service = async () => createMediaService({ database: memory.database, storage, review: options.review ?? { mode: 'disabled', async submit() { throw new Error('disabled'); } },
      now: () => now, newId: () => (++nextId).toString(16).padStart(32, '0'), sessionHash: digest(tokenFor(uid)),
      async revalidateIdentity() { await guard(tokenFor(uid), clientInfo, { refresh: false }); },
    }, await requireFamily(memory.database, await guard(tokenFor(uid), clientInfo)));
    return { async requestUpload(input) { return (await service()).requestUpload(input); }, async upload(input) { return (await service()).upload(input); },
      async complete(input) { return (await service()).complete(input); }, async status(input) { return (await service()).status(input); }, async read(input) { return (await service()).read(input); } };
  };
  const importsConfig = options.importsConfig ?? (() => ({ ...defaultConfig(), enabled: true }));
  const imports = (uid: Id): import('home-contracts').ImportsApi => {
    const service = async () => createImportsService({ database: memory.database, now: () => now, config: importsConfig,
      async revalidateIdentity() { await guard(tokenFor(uid), clientInfo, { refresh: false }); },
    }, await requireFamily(memory.database, await guard(tokenFor(uid), clientInfo)));
    return { async submit(input) { return (await service()).submit(input); }, async get(id) { return (await service()).get(id); }, async cancel(input) { return (await service()).cancel(input); } };
  };
  return {
    async runImports() { return runImportWorker({ database: memory.database, now: () => now, newId: () => (++nextId).toString(16).padStart(32, '0'), config: importsConfig,
      reads: {
        async due(time) { return (await memory.rows<Job>('import_jobs')).filter(row => ['queued', 'running'].includes(row.state) && row.nextRunAt <= time).sort((a, b) => a.nextRunAt - b.nextRunAt).slice(0, 4).map(row => row._id); },
        async expired(time) { return (await memory.rows<Job>('import_jobs')).filter(row => row.purgeAt > 0 && row.purgeAt <= time).slice(0, 20).map(row => row._id); },
      },
      provider: options.importsProvider ?? { async parse() { return { recipe: { title: '盐汤', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
        ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['加水煮开。'], tags: [] }, usage: { inputTokens: 20, outputTokens: 40, costUsd: 0.001, providerRequestId: 'fixture-request' } }; } },
      content: () => options.content ?? { async checkText() { return 'allowed'; } },
      activeUser: async uid => records.has(uid) && (records.get(uid)?.status === null || records.get(uid)?.status === 0), recentlyVisited: options.recentlyVisited ?? (async () => true),
    }); },
    files, storage, get now() { return now; },
    async accountActive(uid: string, sessionHash: string) { try { await guard(tokenFor(uid), clientInfo, { refresh: false }); return sessionHash === digest(tokenFor(uid)); } catch { return false; } },
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
      return { imports: imports(uid), media: media(uid), recipes: recipes(uid), family: family(uid), account: {
        async signInWeixin() { return guard(tokenFor(uid), clientInfo); },
        async session() { return guard(uid ? tokenFor(uid) : undefined, clientInfo); },
        async signOut() { await guard(tokenFor(uid), clientInfo, { refresh: false }); const row = records.get(uid); if (row) row.tokens = []; },
      } };
    },
    advance(ms: number) { now += ms; },
    async rows<T>(collection: string): Promise<T[]> {
      if (collection === 'families' || collection === 'family_members' || collection === 'family_invitations' || collection === 'mutation_receipts' || collection === 'request_limits' || collection === 'recipes' || collection === 'recipe_favorites' || collection === 'media_files' || collection === 'media_audit_traces' || collection === 'import_jobs' || collection === 'quota_buckets' || collection === 'ai_usage') return memory.rows<T>(collection);
      if (collection !== 'uni-id-users') throw new Error('Unsupported fixture collection');
      return [...records].map(([uid, row]) => ({ uid, ...row })) as T[];
    },
    get refreshCalls() { return refreshCalls; },
  };
}
