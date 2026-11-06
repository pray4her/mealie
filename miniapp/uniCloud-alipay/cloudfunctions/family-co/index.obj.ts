import { randomBytes } from 'node:crypto';
import type { ClientInfo, CloudSuccess, FamilyView, Identity, Mutation } from 'home-contracts';
import { AppError, createDatabasePort, createRequireIdentity, createUniIdPorts, now, safeError } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { createFamilyService, createWeixinContentPort } from 'home-family';

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
