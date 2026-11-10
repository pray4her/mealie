import { AppError } from 'home-kernel';
import { MAX_MEDIA_BYTES } from './files';

export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new AppError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function mediaId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new AppError('INVALID_INPUT'); return value;
}
export function mediaIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new AppError('INVALID_INPUT');
  const ids = value.map(mediaId); if (new Set(ids).size !== ids.length) throw new AppError('INVALID_INPUT'); return ids;
}
export function uploadMetadata(row: Record<string, unknown>) {
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)
    || !['recipe-image', 'import-input'].includes(row.purpose as string) || !['image/jpeg', 'image/png'].includes(row.mime as string)
    || typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > MAX_MEDIA_BYTES) throw new AppError('INVALID_INPUT');
}
