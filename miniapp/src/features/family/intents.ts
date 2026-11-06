import type { SessionStorage } from '../../shared/session-boundary';
import { AppError } from '../../shared/errors';
import { normalizeFamilyName, validRequestId } from './validation';

export type PendingIntent = { requestId: string; name: string; uncertain: boolean };
export function createFamilyIntentStore(storage: SessionStorage) {
  const key = (uid: string) => {
    if (!uid.trim()) throw new AppError('AUTH_REQUIRED');
    return `home.family.create.v1:${encodeURIComponent(uid)}`;
  };
  function parse(value: unknown): PendingIntent {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
      || !('requestId' in value) || !validRequestId(value.requestId)
      || !('uncertain' in value) || typeof value.uncertain !== 'boolean' || !('name' in value)) throw new AppError('UNAVAILABLE');
    try { if (normalizeFamilyName(value.name) !== value.name) throw new AppError('UNAVAILABLE'); }
    catch { throw new AppError('UNAVAILABLE'); }
    return { requestId: value.requestId, name: value.name as string, uncertain: value.uncertain };
  }
  return {
    read(uid: string): PendingIntent | null {
      const value = storage.get(key(uid));
      return value === undefined || value === null || value === '' ? null : parse(value);
    },
    write(uid: string, intent: PendingIntent) { storage.set(key(uid), parse(intent)); },
    clear(uid: string) { storage.remove(key(uid)); },
  };
}

// Shape verified against the locked @dcloudio/types 3.4.31 wx patch:
// getRandomValues({ length, success({randomValues:ArrayBuffer}), fail }): void.
type RandomPlatform = { getRandomValues(options: { length: number; success(result: { randomValues: ArrayBuffer }): void; fail(): void }): void };
declare const wx: RandomPlatform | undefined;
export function newRequestId(): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new AppError('UNAVAILABLE'));
    if (typeof wx === 'undefined' || typeof wx.getRandomValues !== 'function') { fail(); return; }
    try {
      wx.getRandomValues({ length: 16, fail, success(result) {
        try {
          const buffer = result?.randomValues;
          // The bridge may return another realm's buffer; the native getter checks its internal brand.
          const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
          if (!byteLength || byteLength.call(buffer) !== 16) { fail(); return; }
          resolve(Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''));
        } catch { fail(); }
      } });
    } catch { fail(); }
  });
}
