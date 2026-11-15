import { randomBytes } from 'node:crypto';
import type { ClientInfo, CloudSuccess, PlanningApi } from 'home-contracts';
import { AppError, createDatabasePort, createRequireIdentity, createUniIdPorts, now, safeError } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { requireFamily } from 'home-family';
import { createPlanningService, createPlanningReads } from 'home-planning';
import type { PlanningReadPlatform } from 'home-planning';

interface Context { getUniIdToken(): string | undefined; getClientInfo(): ClientInfo }
async function call<T>(context: Context, extra: unknown[], action: (service: PlanningApi) => Promise<T>): Promise<CloudSuccess<T> | { errCode: string }> {
  try {
    const clientInfo = context.getClientInfo();
    if (clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin') throw new AppError('AUTH_REQUIRED');
    const token = context.getUniIdToken();
    const requireIdentity = createRequireIdentity({ ...createUniIdPorts(clientInfo), now });
    const identity = await requireIdentity(token, clientInfo);
    if (extra.length) throw new AppError('INVALID_INPUT');
    const platform = (globalThis as unknown as { uniCloud: { database(): DatabasePlatform & PlanningReadPlatform } }).uniCloud.database();
    const database = createDatabasePort(platform, { maxAttempts: 3, backoff: attempt => new Promise(resolve => setTimeout(resolve, 10 * 2 ** (attempt - 1) + randomBytes(1)[0] % 21)) });
    const ctx = await requireFamily(database, identity);
    const service = createPlanningService({
      database, reads: createPlanningReads(platform), now, newId: () => randomBytes(16).toString('hex'),
      async revalidateIdentity() {
        if ((await requireIdentity(token, clientInfo, { refresh: false })).uid !== identity.uid) throw new AppError('AUTH_REQUIRED');
      },
    }, ctx);
    return { errCode: 0, data: await action(service), ...(identity.refreshedToken ? { newToken: identity.refreshedToken } : {}) };
  } catch (error) { return { errCode: safeError(error).code }; }
}
export async function add(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.add(input as Parameters<PlanningApi['add']>[0])); }
export async function list(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.list(input as Parameters<PlanningApi['list']>[0])); }
export async function get(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.get(input as string)); }
export async function update(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, service => service.update(input as Parameters<PlanningApi['update']>[0])); }
export async function remove(this: Context, input: unknown, ...extra: unknown[]) { return call(this, extra, async service => { await service.remove(input as Parameters<PlanningApi['remove']>[0]); return null; }); }
