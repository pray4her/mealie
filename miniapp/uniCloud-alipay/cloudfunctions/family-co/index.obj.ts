import { randomBytes } from 'node:crypto';
import type { ClientInfo, CloudSuccess, FamilyView, Identity, Mutation, FamilyApi, FamilyContext, Invitation, InvitationPage, MemberView } from 'home-contracts';
import { AppError, createDatabasePort, createRequireIdentity, createUniIdPorts, now, safeError } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { createFamilyService, createWeixinContentPort, createInvitationTokens, createFamilyReads } from 'home-family';
import type { FamilyReadPlatform } from 'home-family';

interface Context { getUniIdToken(): string | undefined; getClientInfo(): ClientInfo; getUniCloudRequestId(): string }
type Reply<T> = CloudSuccess<T> | { errCode: string };
interface UserDatabase { collection(name: 'uni-id-users'): { doc(uid: string): { field(fields: { wx_openid: true }): { get(): Promise<unknown> } } } }

async function request(context: Context) {
  const clientInfo = context.getClientInfo();
  if (clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin') throw new AppError('AUTH_REQUIRED');
  const token = context.getUniIdToken();
  const requireIdentity = createRequireIdentity({ ...createUniIdPorts(clientInfo), now });
  const identity = await requireIdentity(token, clientInfo);
  const platform = (globalThis as unknown as { uniCloud: { database(): DatabasePlatform & UserDatabase } }).uniCloud.database();
  const service = createFamilyService({
    database: createDatabasePort(platform, { maxAttempts: 3, backoff: attempt => new Promise(resolve => setTimeout(resolve, 10 * 2 ** (attempt - 1) + randomBytes(1)[0] % 21)) }),
    now, newId: () => randomBytes(16).toString('hex'),
    invitationTokens: createInvitationTokens(() => ({ FAMILY_INVITATION_KEY_VERSION: process.env.FAMILY_INVITATION_KEY_VERSION, FAMILY_INVITATION_KEYS: process.env.FAMILY_INVITATION_KEYS })),
    familyReads: createFamilyReads(platform as unknown as FamilyReadPlatform),
    content: createWeixinContentPort({ uid: identity.uid, appId: clientInfo.appId, requestId: context.getUniCloudRequestId(),
      async readOpenid(uid) {
        const result = await platform.collection('uni-id-users').doc(uid).field({ wx_openid: true }).get();
        if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data) || result.data.length !== 1) throw new AppError('UNAVAILABLE');
        const row: unknown = result.data[0];
        if (!row || typeof row !== 'object' || !('wx_openid' in row)) throw new AppError('UNAVAILABLE');
        return row.wx_openid;
      },
    }),
    async revalidateIdentity() {
      const current = await requireIdentity(token, clientInfo, { refresh: false });
      if (current.uid !== identity.uid) throw new AppError('AUTH_REQUIRED');
    },
  }, identity);
  return { identity, service };
}
function success<T>(data: T, identity: Identity): CloudSuccess<T> {
  return { errCode: 0, data, ...(identity.refreshedToken ? { newToken: identity.refreshedToken } : {}) };
}
export async function current(this: Context, ...args: unknown[]): Promise<Reply<FamilyView | null>> {
  try {
    const { identity, service } = await request(this);
    const input = args[0];
    if (args.length > 1 || (input !== undefined && input !== null
      && (typeof input !== 'object' || Array.isArray(input) || Reflect.ownKeys(input).length !== 0))) throw new AppError('INVALID_INPUT');
    return success(await service.current(), identity);
  } catch (error) { return { errCode: safeError(error).code }; }
}
export async function create(this: Context, input: unknown, ...extra: unknown[]): Promise<Reply<FamilyView>> {
  try {
    const { identity, service } = await request(this);
    if (extra.length) throw new AppError('INVALID_INPUT');
    return success(await service.create(input as Mutation & { name: string }), identity);
  } catch (error) { return { errCode: safeError(error).code }; }
}

async function call<T>(context: Context, extra: unknown[], action: (service: FamilyApi) => Promise<T>): Promise<Reply<T>> {
  try {
    const { identity, service } = await request(context);
    if (extra.length) throw new AppError('INVALID_INPUT');
    return success(await action(service), identity);
  } catch (error) { return { errCode: safeError(error).code }; }
}
function empty(args: unknown[]): void {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== null && (typeof args[0] !== 'object' || Array.isArray(args[0]) || Object.keys(args[0]).length))) throw new AppError('INVALID_INPUT');
}
export async function invite(this: Context, input: unknown, ...extra: unknown[]): Promise<Reply<Invitation>> {
  return call(this, extra, service => service.invite(input as Mutation));
}
export async function revokeInvite(this: Context, input: unknown, ...extra: unknown[]): Promise<Reply<null>> {
  return call(this, extra, async service => { await service.revokeInvite(input as Mutation & { invitationId: string }); return null; });
}
export async function join(this: Context, input: unknown, ...extra: unknown[]): Promise<Reply<FamilyContext>> {
  return call(this, extra, service => service.join(input as Mutation & { token: string }));
}
export async function members(this: Context, ...args: unknown[]): Promise<Reply<MemberView[]>> {
  return call(this, [], service => { empty(args); return service.members(); });
}
export async function invitations(this: Context, input: unknown, ...extra: unknown[]): Promise<Reply<InvitationPage>> {
  return call(this, extra, service => service.invitations(input as { cursor?: string }));
}
