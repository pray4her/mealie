import { randomBytes } from 'node:crypto';
import type { ClientInfo, CloudSuccess, ImportsApi } from 'home-contracts';
import { AppError, createDatabasePort, createRequireIdentity, createUniIdPorts, now, safeError } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { requireFamily } from 'home-family';
import { createImportsService, importConfig } from 'home-imports';

interface Context { getUniIdToken(): string | undefined; getClientInfo(): ClientInfo }
async function call<T>(context: Context, extra: unknown[], action: (service: ImportsApi) => Promise<T>): Promise<CloudSuccess<T> | { errCode: string }> {
  try {
    const clientInfo = context.getClientInfo();
    if (clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin') throw new AppError('AUTH_REQUIRED');
    const token = context.getUniIdToken(); const requireIdentity = createRequireIdentity({ ...createUniIdPorts(clientInfo), now });
    const identity = await requireIdentity(token, clientInfo); if (extra.length) throw new AppError('INVALID_INPUT');
    const platform = (globalThis as unknown as { uniCloud: { database(): DatabasePlatform } }).uniCloud.database();
    const database = createDatabasePort(platform, { maxAttempts: 3, backoff: attempt => new Promise(resolve => setTimeout(resolve, 10 * 2 ** (attempt - 1) + randomBytes(1)[0] % 21)) });
    const service = createImportsService({ database, now, config: () => importConfig(process.env), async revalidateIdentity() {
      if ((await requireIdentity(token, clientInfo, { refresh: false })).uid !== identity.uid) throw new AppError('AUTH_REQUIRED');
    } }, await requireFamily(database, identity));
    return { errCode: 0, data: await action(service), ...(identity.refreshedToken ? { newToken: identity.refreshedToken } : {}) };
  } catch (error) { return { errCode: safeError(error).code }; }
}
export async function submit(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.submit(input as Parameters<ImportsApi['submit']>[0])); }
export async function get(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.get(input as string)); }
export async function cancel(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.cancel(input as Parameters<ImportsApi['cancel']>[0])); }
