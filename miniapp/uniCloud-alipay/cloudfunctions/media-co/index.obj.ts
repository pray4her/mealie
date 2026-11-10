import { randomBytes, createHash } from 'node:crypto';
import type { ClientInfo, CloudSuccess, MediaApi } from 'home-contracts';
import { AppError, createDatabasePort, createRequireIdentity, createUniIdPorts, now, safeError } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { requireFamily } from 'home-family';
import { createMediaService, createStoragePort, createWeixinMediaReview } from 'home-media';
import type { StoragePlatform } from 'home-media';


interface Context { getUniIdToken(): string | undefined; getClientInfo(): ClientInfo; getUniCloudRequestId(): string }
interface UserDatabase { collection(name: 'uni-id-users'): { doc(uid: string): { field(fields: { wx_openid: true }): { get(): Promise<unknown> } } } }
async function call<T>(context: Context, extra: unknown[], action: (service: MediaApi) => Promise<T>): Promise<CloudSuccess<T> | { errCode: string }> {
  try {
    const clientInfo = context.getClientInfo();
    if (clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin') throw new AppError('AUTH_REQUIRED');
    const token = context.getUniIdToken();
    const requireIdentity = createRequireIdentity({ ...createUniIdPorts(clientInfo), now });
    const identity = await requireIdentity(token, clientInfo);
    if (extra.length) throw new AppError('INVALID_INPUT');
    const platform = (globalThis as unknown as { uniCloud: { database(): DatabasePlatform & UserDatabase } }).uniCloud.database();
    const database = createDatabasePort(platform, { maxAttempts: 3, backoff: attempt => new Promise(resolve => setTimeout(resolve, 10 * 2 ** (attempt - 1) + randomBytes(1)[0] % 21)) });
    const ctx = await requireFamily(database, identity);
    const cloud = (globalThis as unknown as { uniCloud: StoragePlatform }).uniCloud;
    const service = createMediaService({
      database, storage: createStoragePort(cloud, now), sessionHash: createHash('sha256').update(token!).digest('hex'), now, newId: () => randomBytes(16).toString('hex'),
      review: createWeixinMediaReview({ enabled: process.env.MEDIA_REVIEW_ENABLED === 'true', uid: identity.uid, appId: clientInfo.appId, requestId: context.getUniCloudRequestId(),
        async readOpenid(uid) {
          const result = await platform.collection('uni-id-users').doc(uid).field({ wx_openid: true }).get();
          if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data) || result.data.length !== 1) throw new AppError('UNAVAILABLE');
          const row: unknown = result.data[0];
          if (!row || typeof row !== 'object' || !('wx_openid' in row)) throw new AppError('UNAVAILABLE');
          return row.wx_openid;
        },
      }),
      async revalidateIdentity() {
        if ((await requireIdentity(token, clientInfo, { refresh: false })).uid !== identity.uid) throw new AppError('AUTH_REQUIRED');
      },
    }, ctx);
    return { errCode: 0, data: await action(service), ...(identity.refreshedToken ? { newToken: identity.refreshedToken } : {}) };
  } catch (error) { return { errCode: safeError(error).code }; }
}
export async function requestUpload(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.requestUpload(input as Parameters<MediaApi['requestUpload']>[0])); }
export async function upload(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.upload(input as Parameters<MediaApi['upload']>[0])); }
export async function complete(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.complete(input as Parameters<MediaApi['complete']>[0])); }
export async function status(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.status(input as Parameters<MediaApi['status']>[0])); }
export async function read(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.read(input as Parameters<MediaApi['read']>[0])); }
