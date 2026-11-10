import { randomBytes } from 'node:crypto';
import { AppError, createDatabasePort, now } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { createWeixinContentPort } from 'home-family';
import { createImportReads, createOpenRouterProvider, importConfig, runImportWorker } from 'home-imports';
import type { ImportReadPlatform } from 'home-imports';

interface UserDatabase { collection(name: string): { doc(uid: string): { field(fields: Record<string, boolean>): { get(): Promise<unknown> } } } }
// uniCloud invokes this private lifecycle method; no public worker method or URL exists.
export async function _timing() {
  const platform = (globalThis as unknown as { uniCloud: { database(): DatabasePlatform } }).uniCloud.database();
  const database = createDatabasePort(platform, { maxAttempts: 3, backoff: attempt => new Promise(resolve => setTimeout(resolve, 10 * 2 ** (attempt - 1) + randomBytes(1)[0] % 21)) });
  async function user(uid: string): Promise<Record<string, unknown> | null> {
    const result = await (platform as unknown as UserDatabase).collection('uni-id-users').doc(uid).field({ status: true, wx_openid: true }).get();
    if (!result || typeof result !== 'object' || 'errCode' in result && result.errCode !== 0 || !('data' in result) || !Array.isArray(result.data)) throw new AppError('UNAVAILABLE');
    const row: unknown = result.data[0]; return row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null;
  }
  return runImportWorker({ database, now, newId: () => randomBytes(16).toString('hex'), config: () => importConfig(process.env),
    reads: createImportReads(platform as unknown as ImportReadPlatform), provider: createOpenRouterProvider({ apiKey: () => process.env.OPENROUTER_API_KEY }),
    async activeUser(uid) { const row = await user(uid); return !!row && (row.status === undefined || row.status === 0); },
    async recentlyVisited(job) { return Number.isSafeInteger(job.visitedAt) && job.visitedAt <= now() && now() - job.visitedAt < 2 * 3600000; },
    content(job) { return createWeixinContentPort({ uid: job.uid, appId: '__UNI__5FDC0D7', requestId: 'import-' + job._id, scene: 3, timeoutMs: 5000, async readOpenid(uid) { return (await user(uid))?.wx_openid; } }); },
  });
}
