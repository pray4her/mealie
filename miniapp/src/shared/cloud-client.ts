import type { Identity } from 'home-contracts';
import type { SessionBoundary } from './session-boundary';
import { AppError, errorCode } from './errors';
export type Transport = (object: string, method: string, input: unknown) => Promise<unknown>;
export interface AccountWireApi { loginByWeixin(code: string): Promise<void>; session(): Promise<Identity>; logout(): Promise<void> }
export function createCloudClient({ transport, boundary }: { transport: Transport; boundary: SessionBoundary }): { invoke<T>(object: string, method: string, input: unknown): Promise<T>; account: AccountWireApi } {
  async function call(kind: 'business' | 'login' | 'logout' | 'session', object: string, method: string, input: unknown) {
    try {
      return await boundary.run(kind, async () => {
        const raw = await transport(object, method, input);
        if (!raw || typeof raw !== 'object' || !('errCode' in raw)) throw new AppError('UNAVAILABLE');
        if (raw.errCode !== 0) throw new AppError(errorCode({ code: raw.errCode }));
        return raw;
      });
    } catch (error) { throw new AppError(errorCode(error)); }
  }
  return {
    async invoke<T>(object: string, method: string, input: unknown): Promise<T> {
      const raw = await call('business', object, method, input); return ('data' in raw ? raw.data : undefined) as T;
    },
    account: {
      async loginByWeixin(code) { await call('login', 'uni-id-co', 'loginByWeixin', { code }); },
      async session() {
        const raw = await call('session', 'account-co', 'session', {});
        if (!('data' in raw) || !raw.data || typeof raw.data !== 'object' || Object.keys(raw.data).some(key => key !== 'uid') || !('uid' in raw.data) || typeof raw.data.uid !== 'string' || !raw.data.uid) throw new AppError('UNAVAILABLE');
        return { uid: raw.data.uid };
      },
      async logout() { await call('logout', 'uni-id-co', 'logout', {}); },
    },
  };
}
