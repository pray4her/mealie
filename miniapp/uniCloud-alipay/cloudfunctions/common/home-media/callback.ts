import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import type { DatabasePort } from 'home-kernel';
import { AppError } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { digest } from './files';
import { mediaRecord } from './model';

type Verdict = 'pass' | 'reject' | 'error';
type Trace = { _id: string; mediaId: string; traceId: string; attempt: string; verdict: Verdict | null };
export async function receiveReview(deps: { database: DatabasePort; now(): number; accountActive(uid: string, sessionHash: string): Promise<boolean> }, traceId: string, verdict: Verdict) {
  const id = digest(traceId);
  const trace = await deps.database.transaction(tx => tx.get<Trace>('media_audit_traces', id));
  if (!trace || trace.traceId !== traceId) throw new AppError('UNAVAILABLE');
  await deps.database.transaction(async tx => {
    const trace = await tx.get<Trace>('media_audit_traces', id);
    if (!trace) throw new AppError('UNAVAILABLE');
    // First authenticated notification wins, including conflicting repeated notifications.
    if (trace.verdict !== null) return;
    const row = await mediaRecord(tx, trace.mediaId);
    if (row.state === 'pending' && row.traceId === traceId && row.attempt === trace.attempt) {
      const accountActive = await deps.accountActive(row.uid, row.sessionHash);
      const ctx = await readFamily(tx, row.uid);
      const current = accountActive && ctx?.familyId === row.familyId && ctx.generation === row.generation;
      if (current && ctx) await guardMutation(tx, ctx);
      const state = !current ? 'failed' : row.reviewExpiresAt === null || row.reviewExpiresAt <= deps.now() || verdict === 'error' ? 'review-error' : verdict === 'pass' ? 'ready' : 'rejected';
      await tx.replace('media_files', row._id, { ...row, state, updatedAt: deps.now(), cleanupAt: deps.now() + 86_400_000 });
    }
    await tx.replace('media_audit_traces', id, { ...trace, verdict });
  });
}
type HttpEvent = { httpMethod?: string; queryStringParameters?: Record<string, unknown>; body?: string; isBase64Encoded?: boolean };
type CallbackConfig = { token?: string; encodingAESKey?: string; appId?: string };
function xmlField(xml: string, key: string): string {
  const matches = [...xml.matchAll(new RegExp('<' + key + '>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</' + key + '>', 'g'))];
  if (matches.length !== 1) throw new AppError('FORBIDDEN'); return matches[0][1] ?? matches[0][2];
}
export async function handleReviewNotification(event: HttpEvent, config: CallbackConfig, now: () => number, deliver: (traceId: string, verdict: Verdict) => Promise<void>) {
  const response = (statusCode: number, body: string) => ({ statusCode, headers: { 'Content-Type': 'text/plain' }, body });
  try {
    if (!config.token || !config.encodingAESKey || !/^[A-Za-z0-9+/]{43}$/.test(config.encodingAESKey) || !config.appId) throw new AppError('UNAVAILABLE');
    const query = event.queryStringParameters ?? {};
    const { timestamp, nonce, msg_signature: signature } = query;
    if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(Number(timestamp) * 1000 - now()) > 300_000
      || typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 128 || typeof signature !== 'string' || !/^[a-f0-9]{40}$/.test(signature)) throw new AppError('FORBIDDEN');
    let encrypted: unknown;
    if (event.httpMethod === 'GET') encrypted = query.echostr;
    else if (event.httpMethod === 'POST' && typeof event.body === 'string' && event.body.length <= 65_536) {
      const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      if (body.trim().startsWith('{')) encrypted = (JSON.parse(body) as { Encrypt?: unknown }).Encrypt;
      else encrypted = xmlField(body, 'Encrypt');
    } else throw new AppError('FORBIDDEN');
    if (typeof encrypted !== 'string' || encrypted.length > 65_536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw new AppError('FORBIDDEN');
    const expected = createHash('sha1').update([config.token, timestamp, nonce, encrypted].sort().join('')).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new AppError('FORBIDDEN');
    const key = Buffer.from(config.encodingAESKey + '=', 'base64'); const ciphertext = Buffer.from(encrypted, 'base64');
    if (ciphertext.length === 0 || ciphertext.length % 16) throw new AppError('FORBIDDEN');
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)); decipher.setAutoPadding(false);
    const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]); const padding = clear.at(-1)!;
    if (padding < 1 || padding > 32 || !clear.subarray(-padding).every(byte => byte === padding)) throw new AppError('FORBIDDEN');
    const value = clear.subarray(0, -padding);
    if (value.length < 20) throw new AppError('FORBIDDEN');
    const length = value.readUInt32BE(16);
    if (length > value.length - 20 || value.subarray(20 + length).toString('utf8') !== config.appId) throw new AppError('FORBIDDEN');
    const message = value.subarray(20, 20 + length).toString('utf8');
    if (event.httpMethod === 'GET') return response(200, message);
    let traceId: unknown; let suggest: unknown; let errcode: unknown; let eventName: unknown; let appid: unknown;
    if (message.trim().startsWith('{')) {
      const row = JSON.parse(message) as { trace_id?: unknown; result?: { suggest?: unknown }; errcode?: unknown; Event?: unknown; appid?: unknown };
      traceId = row.trace_id; suggest = row.result?.suggest; errcode = row.errcode; eventName = row.Event; appid = row.appid;
    } else {
      traceId = xmlField(message, 'trace_id'); errcode = Number(xmlField(message, 'errcode')); eventName = xmlField(message, 'Event'); appid = xmlField(message, 'appid');
      suggest = errcode === 0 ? xmlField(message, 'suggest') : undefined;
    }
    if (eventName !== 'wxa_media_check' || appid !== config.appId || typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(traceId)
      || typeof errcode !== 'number' || !Number.isSafeInteger(errcode) || errcode === 0 && !['pass', 'review', 'risky'].includes(suggest as string)) throw new AppError('FORBIDDEN');
    await deliver(traceId, errcode !== 0 ? 'error' : suggest === 'pass' ? 'pass' : 'reject');
    return response(200, 'success');
  } catch (error) { return response(error instanceof AppError && error.code === 'FORBIDDEN' ? 403 : 503, ''); }
}
