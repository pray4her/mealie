import type { AccountApi } from 'home-contracts';
import type { AccountWireApi } from '../../shared/cloud-client';
import type { SessionBoundary } from '../../shared/session-boundary';
import { observeBoundaryClosure } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
const accountBoundaries = new WeakMap<AccountApi, SessionBoundary>();
export function observeAccountClosure(account: AccountApi, listener: (closing: boolean) => void): () => void {
  const boundary = accountBoundaries.get(account);
  return boundary ? observeBoundaryClosure(boundary, listener) : () => {};
}
export function createAccountApi({ wire, platformLogin, boundary }: { wire: AccountWireApi; platformLogin: () => Promise<string>; boundary: SessionBoundary }): AccountApi {
  const account: AccountApi = {
    signInWeixin() {
      return boundary.login(async () => {
        const epoch = boundary.epoch; const code = await platformLogin();
        if (boundary.epoch !== epoch || boundary.closing) throw new AppError('AUTH_REQUIRED');
        await wire.loginByWeixin(code);
        if (boundary.epoch !== epoch || boundary.closing) throw new AppError('AUTH_REQUIRED');
        return wire.session();
      });
    },
    async session() {
      try { return await wire.session(); }
      catch (error) {
        if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {});
        throw error;
      }
    },
    signOut() { return boundary.close(() => wire.logout()); },
  };
  accountBoundaries.set(account, boundary);
  return account;
}
