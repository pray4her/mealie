import type { AccountStatusPort, ClientInfo, TokenPort } from 'home-contracts';
import { AppError } from './errors';
import type { CloudPlatform } from './platform';

type CheckResult = { errCode: string | number; uid?: string; iat?: number; exp?: number; token?: string; tokenExpired?: number };
interface UniIdModule { createInstance(options: { clientInfo: ClientInfo }): { checkToken(token: string, options: { autoRefresh: boolean }): Promise<CheckResult> } }
function checked(result: CheckResult): CheckResult {
  if (result.errCode !== 0) throw new AppError('AUTH_REQUIRED');
  return result;
}
export function createUniIdPorts(clientInfo: ClientInfo): { tokens: TokenPort; accounts: AccountStatusPort } {
  // Platform SDK is loaded only inside a real request, never on module import.
  const uniId: UniIdModule = require('uni-id-common');
  const instance = uniId.createInstance({ clientInfo });
  const cloud = (globalThis as unknown as { uniCloud: CloudPlatform }).uniCloud;
  return {
    tokens: {
      async verify(token) {
        const result = checked(await instance.checkToken(token, { autoRefresh: false }));
        if (typeof result.uid !== 'string' || !Number.isSafeInteger(result.iat) || !Number.isSafeInteger(result.exp)) throw new AppError('AUTH_REQUIRED');
        return { uid: result.uid, issuedAtSeconds: result.iat!, expiresAtSeconds: result.exp! };
      },
      async refreshIfNeeded(token) {
        const result = checked(await instance.checkToken(token, { autoRefresh: true }));
        if (!result.token) return null;
        if (typeof result.tokenExpired !== 'number' || !Number.isFinite(result.tokenExpired)) throw new AppError('UNAVAILABLE');
        return { token: result.token, tokenExpired: result.tokenExpired };
      },
    },
    accounts: {
      async get(uid) {
        const result = await cloud.database().collection('uni-id-users').doc(uid).field({ status: true, token: true, valid_token_date: true }).get();
        const row = result.data[0]; if (!row) return null;
        if (row.status !== undefined && typeof row.status !== 'number') throw new AppError('AUTH_REQUIRED');
        if (row.valid_token_date !== undefined && typeof row.valid_token_date !== 'number') throw new AppError('AUTH_REQUIRED');
        return { status: row.status ?? null, tokens: Array.isArray(row.token) && row.token.every(value => typeof value === 'string') ? row.token : [], validTokenDateMs: row.valid_token_date ?? null };
      },
    },
  };
}
