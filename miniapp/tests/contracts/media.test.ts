import { createCipheriv, createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { handleReviewNotification, createStoragePort, createWeixinMediaReview } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import { cloudFixture } from '../support/cloud-platform';
import { png } from '../support/media-fixtures';
import type { MediaRecord, StoragePlatform } from '../../uniCloud-alipay/cloudfunctions/common/home-media';

const now = 1_800_000_000_000;
const config = { token: 'synthetic-callback-token', encodingAESKey: Buffer.alloc(32, 7).toString('base64').slice(0, -1), appId: 'wx-synthetic' };
function notification(message: unknown, options: { appId?: string; timestamp?: number; method?: string } = {}) {
  const text = typeof message === 'string' ? message : JSON.stringify(message); const bytes = Buffer.from(text); const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const raw = Buffer.concat([Buffer.alloc(16, 9), size, bytes, Buffer.from(options.appId ?? config.appId)]); const pad = 32 - raw.length % 32;
  const key = Buffer.from(config.encodingAESKey + '=', 'base64'); const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64');
  const timestamp = String(Math.floor((options.timestamp ?? now) / 1000)); const nonce = 'synthetic-nonce';
  return { httpMethod: options.method ?? 'POST', queryStringParameters: { timestamp, nonce, msg_signature: createHash('sha1').update([config.token, timestamp, nonce, encrypted].sort().join('')).digest('hex'), echostr: encrypted }, body: JSON.stringify({ Encrypt: encrypted }) };
}
const message = () => ({ Event: 'wxa_media_check', appid: config.appId, trace_id: 'trace-123', errcode: 0, result: { suggest: 'pass' } });
test('safe_mode_callback_verifies_signature_decrypts_appid_and_supports_handshake', async () => {
  const calls: unknown[] = []; const deliver = async (...args: unknown[]) => { calls.push(args); };
  expect(await handleReviewNotification(notification(message()), config, () => now, deliver)).toMatchObject({ statusCode: 200, body: 'success' });
  expect(calls).toEqual([['trace-123', 'pass']]);
  expect(await handleReviewNotification(notification('challenge', { method: 'GET' }), config, () => now, deliver)).toMatchObject({ statusCode: 200, body: 'challenge' });
  expect(await handleReviewNotification(notification('<xml><Event>wxa_media_check</Event><appid>wx-synthetic</appid><trace_id>trace-123</trace_id><errcode>0</errcode><result><suggest>risky</suggest></result></xml>'), config, () => now, deliver)).toMatchObject({ statusCode: 200 });
  expect(calls.at(-1)).toEqual(['trace-123', 'reject']);
});
test('forged_replayed_expired_wrong_app_and_malformed_callbacks_cannot_deliver', async () => {
  let called = 0; const deliver = async () => { called++; };
  const forged = notification(message()); forged.queryStringParameters.msg_signature = '0'.repeat(40);
  const cases = [forged, notification(message(), { appId: 'wrong' }), notification({ ...message(), appid: 'wrong' }), notification(message(), { timestamp: now - 300001 }),
    notification({ ...message(), Event: 'other' }), notification({ ...message(), trace_id: 'bad/trace' }), notification({ ...message(), result: { suggest: 'unknown' } })];
  for (const event of cases) expect((await handleReviewNotification(event, config, () => now, deliver)).statusCode).toBe(403);
  expect(called).toBe(0);
  expect((await handleReviewNotification(notification(message()), {}, () => now, deliver)).statusCode).toBe(503);
  expect((await handleReviewNotification(notification(message()), config, () => now, async () => { throw new Error('trace not registered yet'); })).statusCode).toBe(503);
});
test('storage_adapter_scopes_writes_checks_responses_and_reports_actual_expiry', async () => {
  const path = 'task07-private/' + 'a'.repeat(32) + '/' + 'b'.repeat(32) + '.png'; const id = 'cloud://mock/' + path; const calls: unknown[] = [];
  let url = 'https://mock.invalid/file?expire_at=' + (now / 1000 + 900);
  const platform: StoragePlatform = { async uploadFile(input) { calls.push(input.cloudPath); return { fileID: id }; }, async downloadFile() { return { fileContent: png }; },
    async getTempFileURL(input) { calls.push(input); return { fileList: [{ fileID: id, tempFileURL: url }] }; }, async deleteFile(input) { return { fileList: input.fileList.map(fileID => ({ fileID, status: 0 })) }; } };
  const adapter = createStoragePort(platform, () => now);
  expect(await adapter.upload(path, png)).toBe(id); expect(await adapter.read(id)).toEqual(png);
  expect(await adapter.sign(id)).toEqual({ url, expiresAt: now + 900000 });
  expect(calls).toContainEqual({ fileList: [id], maxAge: 600 });
  for (const bad of ['https://attacker.invalid/x', 'cloud://mock/elsewhere/x']) await expect(adapter.read(bad)).rejects.toBeDefined();
  for (const bad of ['https://mock.invalid/no-expiry', 'https://mock.invalid/?expire_at=1', 'http://mock.invalid/?expire_at=2000000000']) { url = bad; await expect(adapter.sign(id)).rejects.toBeDefined(); }
});
test('storage_cleanup_reconstructs_orphan_ids_only_in_trusted_space_and_validates_each_result', async () => {
  const path = 'task07-private/' + 'a'.repeat(32) + '/' + 'b'.repeat(32) + '.png'; const id = 'cloud://mock/' + path; const removed: string[][] = [];
  let failed = false;
  const platform: StoragePlatform = { async uploadFile() { return { fileID: id }; }, async downloadFile() { return { fileContent: png }; }, async getTempFileURL() { return {}; },
    async deleteFile(input) { removed.push(input.fileList); return { fileList: input.fileList.map(fileID => ({ fileID, status: failed ? 1 : 0 })) }; } };
  const adapter = createStoragePort(platform, () => now, 'mock');
  await adapter.remove([path, id]); expect(removed).toEqual([[id]]);
  for (const bad of ['cloud://other/' + path, '../' + path, 'task07-private/another.png']) await expect(adapter.remove([bad])).rejects.toBeDefined();
  failed = true; await expect(adapter.remove([id])).rejects.toBeDefined();
});
test('weixin_v2_review_uses_server_openid_and_does_not_load_sdk_when_disabled', async () => {
  const calls: unknown[] = [];
  const options = { enabled: true, uid: 'alice', appId: '__UNI__5FDC0D7', requestId: 'platform-request', async readOpenid() { return { mp___UNI__5FDC0D7: 'trusted-openid' }; },
    loadChecker: () => class { constructor(value: unknown) { calls.push(value); } async imgSecCheck(input: unknown) { calls.push(input); return { errCode: 0, traceId: 'trusted-trace' }; } } };
  expect(await createWeixinMediaReview(options).submit({} as MediaRecord, 'https://mock.invalid/file')).toBe('trusted-trace');
  expect(calls[1]).toEqual({ image: 'https://mock.invalid/file', openid: 'trusted-openid', scene: 3, version: 2 });
  expect(createWeixinMediaReview({ ...options, enabled: false, loadChecker() { throw new Error('must stay lazy'); } }).mode).toBe('disabled');
  await expect(createWeixinMediaReview({ ...options, async readOpenid() { return {}; } }).submit({} as MediaRecord, 'https://mock.invalid')).rejects.toBeDefined();
});
test('media_cloud_object_authenticates_before_storage_and_has_only_five_methods', async () => {
  const f = cloudFixture('media-co'); const stamp = Date.now();
  f.rows.set('families/home', { _id: 'home', name: '家', ownerUid: 'alice', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp });
  f.rows.set('family_members/alice', { _id: 'alice', familyId: 'home', generation: 'generation', role: 'owner', mutationSeq: 0, joinedAt: stamp, updatedAt: stamp });
  expect(Object.keys(f.entry).sort()).toEqual(['complete', 'read', 'requestUpload', 'status', 'upload']); expect(f.sdkImports).toBe(0);
  for (const method of ['requestUpload', 'upload', 'complete', 'status', 'read'] as const) {
    expect(await f.entry[method].call({ ...f.context, getUniIdToken: () => 'forged' }, {})).toEqual({ errCode: 'AUTH_REQUIRED' });
    expect(await f.entry[method].call(f.context, {}, 'extra')).toEqual({ errCode: 'INVALID_INPUT' });
  }
  const scope = { familyId: 'home', generation: 'generation' };
  const result = await f.entry.requestUpload.call(f.context, { ...scope, requestId: 'cloud-media-request-01', purpose: 'recipe-image', mime: 'image/png', bytes: png.length }) as { data: { mediaId: string } };
  expect(result).toMatchObject({ errCode: 0, data: { state: 'requested', review: 'disabled' } });
  const ref = { ...scope, mediaId: result.data.mediaId };
  expect(await f.entry.upload.call(f.context, { ...ref, base64: png.toString('base64') })).toMatchObject({ errCode: 0, data: { state: 'uploaded' } });
  expect(await f.entry.complete.call(f.context, ref)).toMatchObject({ errCode: 0, data: { state: 'ready' } });
  expect(await f.entry.read.call(f.context, ref)).toMatchObject({ errCode: 0, data: { mediaId: result.data.mediaId } });
  f.revoke(); expect(await f.entry.read.call(f.context, ref)).toEqual({ errCode: 'AUTH_REQUIRED' });
});
