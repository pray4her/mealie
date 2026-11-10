import { expect, test } from 'vitest';
import { createMediaApi } from '../../src/features/media/api';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage } from '../support/sdk-transport';
import { AppError } from '../../src/shared/errors';
const ref = { familyId: 'home', generation: 'gen', mediaId: 'a'.repeat(32) };
test('media_dtos_reject_arbitrary_storage_paths_and_oversized_requests_before_network', async () => {
  let calls = 0; const api = createMediaApi({ boundary: createSessionBoundary(createMemoryStorage()), async invoke<T>() { calls++; return null as T; } });
  await expect(api.read({ ...ref, path: 'cloud://forged' } as typeof ref)).rejects.toBeDefined();
  await expect(api.upload({ ...ref, base64: 'x'.repeat(1398105) })).rejects.toBeDefined();
  await expect(api.status({ familyId: 'home', generation: 'gen', mediaIds: Array(21).fill(ref.mediaId) })).rejects.toBeDefined();
  await expect(api.requestUpload({ familyId: 'home', generation: 'gen', requestId: 'media-request-0001', purpose: 'recipe-image', mime: 'image/png', bytes: 1048577 })).rejects.toBeDefined(); expect(calls).toBe(0);
});
test('media_response_dtos_reject_extra_private_fields_and_mismatched_ids', async () => {
  let result: unknown = { mediaId: ref.mediaId, state: 'ready', uploadExpiresAt: 1, review: 'disabled', retryable: false, fileId: 'cloud://private' };
  const api = createMediaApi({ boundary: createSessionBoundary(createMemoryStorage()), async invoke<T>() { return result as T; } });
  await expect(api.complete(ref)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  result = { mediaId: 'b'.repeat(32), url: 'https://mock.invalid/file', expiresAt: Date.now() + 600000 }; await expect(api.read(ref)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  result = [{ mediaId: 'b'.repeat(32), state: 'ready', uploadExpiresAt: 1, review: 'disabled', retryable: false }]; await expect(api.status({ familyId: ref.familyId, generation: ref.generation, mediaIds: [ref.mediaId] })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('media_auth_failure_closes_session_boundary', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'fixture'); const boundary = createSessionBoundary(storage);
  const api = createMediaApi({ boundary, async invoke() { throw new AppError('AUTH_REQUIRED'); } }); await expect(api.read(ref)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' }); expect(storage.get('uni_id_token')).toBeUndefined();
});
