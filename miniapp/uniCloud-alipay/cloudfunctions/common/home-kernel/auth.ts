import type { AccountStatusPort, ClientInfo, Identity, TokenPort } from 'home-contracts';
import { AppError, safeError } from './errors';

export function createRequireIdentity(deps: { tokens: TokenPort; accounts: AccountStatusPort; now: () => number }) {
  return async (token: string | undefined, clientInfo: ClientInfo, options: { refresh?: boolean } = {}): Promise<Identity> => {
    if (!token || clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin') throw new AppError('AUTH_REQUIRED');
    try {
      const verified = await deps.tokens.verify(token, clientInfo);
      if (!verified.uid || !Number.isSafeInteger(verified.issuedAtSeconds) || !Number.isSafeInteger(verified.expiresAtSeconds)
        || verified.expiresAtSeconds * 1000 <= deps.now()) throw new AppError('AUTH_REQUIRED');
      const account = await deps.accounts.get(verified.uid);
      if (!account || (account.status !== null && account.status !== 0) || !account.tokens.includes(token)
        || (account.validTokenDateMs !== null && (!Number.isFinite(account.validTokenDateMs) || verified.issuedAtSeconds * 1000 < account.validTokenDateMs))) {
        throw new AppError('AUTH_REQUIRED');
      }
      const refreshedToken = options.refresh === false ? null : await deps.tokens.refreshIfNeeded(token, clientInfo);
      return refreshedToken ? { uid: verified.uid, refreshedToken } : { uid: verified.uid };
    } catch (error) { throw safeError(error); }
  };
}
