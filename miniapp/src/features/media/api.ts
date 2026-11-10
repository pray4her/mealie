import type { MediaApi, MediaLink, MediaView, MediaUploadRequest, MediaRef, MediaUpload, MediaContext } from 'home-contracts';
import type { Invoke } from '../family/api';
import type { SessionBoundary } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, validId } from '../recipes/validation';

export function parseMediaView(value: unknown): MediaView {
  try {
    const row = object(value, ['mediaId', 'state', 'uploadExpiresAt', 'review', 'retryable']); validId(row.mediaId);
    if (!['requested', 'uploading', 'uploaded', 'checking', 'pending', 'ready', 'rejected', 'review-error', 'failed'].includes(row.state as string)
      || !['disabled', 'weixin', 'mock'].includes(row.review as string) || typeof row.retryable !== 'boolean'
      || !Number.isSafeInteger(row.uploadExpiresAt) || (row.uploadExpiresAt as number) < 0) throw new Error();
    return row as MediaView;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function parseMediaRequest(value: unknown): MediaUploadRequest {
  const row = object(value, ['familyId', 'generation', 'requestId', 'purpose', 'mime', 'bytes']);
  context(row);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId) || !['recipe-image', 'import-input'].includes(row.purpose as string)
    || !['image/png', 'image/jpeg'].includes(row.mime as string) || !Number.isSafeInteger(row.bytes) || (row.bytes as number) < 1 || (row.bytes as number) > 1_048_576) throw new AppError('INVALID_INPUT');
  return row as MediaUploadRequest;
}
function context(row: Record<string, unknown>) {
  for (const key of ['familyId', 'generation']) if (typeof row[key] !== 'string' || !(row[key] as string).trim() || (row[key] as string).length > 128) throw new AppError('INVALID_INPUT');
}
export function parseMediaRef(value: unknown, upload = false): MediaRef | MediaUpload {
  const row = object(value, ['familyId', 'generation', 'mediaId', ...(upload ? ['base64'] : [])]); context(row); validId(row.mediaId);
  if (upload && (typeof row.base64 !== 'string' || row.base64.length > 1_398_104 || row.base64.length === 0)) throw new AppError('INVALID_INPUT');
  return row as MediaRef | MediaUpload;
}
export function createMediaApi({ invoke, boundary }: { invoke: Invoke; boundary: SessionBoundary }): MediaApi {
  async function call(method: string, input: unknown) {
    try { return await invoke('media-co', method, input); }
    catch (error) { if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {}); throw new AppError(errorCode(error)); }
  }
  async function view(method: string, input: unknown) {
    const result = parseMediaView(await call(method, input));
    if (input && typeof input === 'object' && 'mediaId' in input && result.mediaId !== input.mediaId) throw new AppError('UNAVAILABLE');
    return result;
  }
  return {
    async requestUpload(input) { return view('requestUpload', parseMediaRequest(input)); },
    async upload(input) { return view('upload', parseMediaRef(input, true)); },
    async complete(input) { return view('complete', parseMediaRef(input)); },
    async status(input) {
      const row = object(input, ['familyId', 'generation', 'mediaIds']); context(row);
      if (!Array.isArray(row.mediaIds) || row.mediaIds.length > 20 || new Set(row.mediaIds).size !== row.mediaIds.length) throw new AppError('INVALID_INPUT');
      row.mediaIds.forEach(validId); const result = await call('status', row as MediaContext & { mediaIds: string[] });
      if (!Array.isArray(result) || result.length !== row.mediaIds.length) throw new AppError('UNAVAILABLE');
      const values = result.map(parseMediaView);
      if (values.some((value, index) => value.mediaId !== (row.mediaIds as string[])[index])) throw new AppError('UNAVAILABLE'); return values;
    },
    async read(input): Promise<MediaLink> {
      const ref = parseMediaRef(input); const result = await call('read', ref);
      try {
        const row = object(result, ['mediaId', 'url', 'expiresAt']);
        if (row.mediaId !== input.mediaId || typeof row.url !== 'string' || !/^https:\/\/[^\s]+$/.test(row.url)
          || !Number.isSafeInteger(row.expiresAt) || (row.expiresAt as number) <= Date.now()) throw new Error();
        return row as MediaLink;
      } catch { throw new AppError('UNAVAILABLE'); }
    },
  };
}
