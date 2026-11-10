import { createDatabasePort, createRequireIdentity, createUniIdPorts } from 'home-kernel';
import type { DatabasePlatform } from 'home-kernel';
import { handleReviewNotification, receiveReview } from 'home-media';
import type { handleReviewNotification as Handler } from 'home-media';
import { createHash } from 'node:crypto';

interface Platform { database(): DatabasePlatform & { collection(name: string): { doc(id: string): { field(fields: object): { get(): Promise<{ data?: { status?: number; token?: string[] }[] }> } } } } }
export async function main(event: Parameters<typeof Handler>[0]) {
  return handleReviewNotification(event, { token: process.env.MEDIA_REVIEW_CALLBACK_TOKEN, encodingAESKey: process.env.MEDIA_REVIEW_ENCODING_AES_KEY, appId: process.env.MEDIA_REVIEW_WEIXIN_APP_ID }, Date.now, async (traceId, verdict) => {
    const platform = (globalThis as unknown as { uniCloud: Platform }).uniCloud.database();
    await receiveReview({ database: createDatabasePort(platform, { maxAttempts: 3, backoff: async () => {} }), now: Date.now, async accountActive(uid, sessionHash) {
      const result = await platform.collection('uni-id-users').doc(uid).field({ status: true, token: true }).get();
      const row = result.data?.length === 1 ? result.data[0] : null;
      if (!row || row.status !== undefined && row.status !== 0 || !Array.isArray(row.token)) return false;
      const token = row.token.find(token => typeof token === 'string' && createHash('sha256').update(token).digest('hex') === sessionHash);
      if (!token) return false;
      const clientInfo = { appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' };
      try { return (await createRequireIdentity({ ...createUniIdPorts(clientInfo), now: Date.now })(token, clientInfo, { refresh: false })).uid === uid; }
      catch { return false; }
    } }, traceId, verdict);
  });
}
