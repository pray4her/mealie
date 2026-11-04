import type { ClientInfo, CloudSuccess } from 'home-contracts';
import { AppError, createRequireIdentity, createRequestLimiter, createUniIdPorts, now, safeError } from 'home-kernel';
interface Context { getUniIdToken(): string | undefined; getClientInfo(): ClientInfo }
const limiter = createRequestLimiter({ now, windowMs: 60_000, maxPerWindow: 60, maxKeys: 1024 });

export async function session(this: Context): Promise<CloudSuccess<{ uid: string }> | { errCode: string }> {
  try {
    const clientInfo = this.getClientInfo();
    if (clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin') throw new AppError('AUTH_REQUIRED');
    const requireIdentity = createRequireIdentity({ ...createUniIdPorts(clientInfo), now });
    const identity = await requireIdentity(this.getUniIdToken(), clientInfo);
    limiter.consume(`${identity.uid}:session`);
    return { errCode: 0, data: { uid: identity.uid }, ...(identity.refreshedToken ? { newToken: identity.refreshedToken } : {}) };
  } catch (error) { return { errCode: safeError(error).code }; }
}
