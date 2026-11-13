import { expect, test, vi } from 'vitest';
import { createImportsApi } from '../../src/features/imports/api';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage } from '../support/sdk-transport';
import type { Invoke } from '../../src/features/family/api';
const job = () => ({ id: 'a'.repeat(32), state: 'queued', attempts: 0, recipeId: null, error: null, createdAt: 1, updatedAt: 2 });
test('import_adapter_checks_wire_shape_and_never_accepts_private_job_fields', async () => {
  const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => job()); const api = createImportsApi({ invoke: async <T>(...args: Parameters<Invoke>): Promise<T> => await invoke(...args) as T, boundary: createSessionBoundary(createMemoryStorage()) });
  expect(await api.get('a'.repeat(32))).toEqual(job()); expect(invoke).toHaveBeenCalledWith('imports-co', 'get', 'a'.repeat(32));
  for (const invalid of [{ ...job(), sourceText: 'private' }, { ...job(), state: 'unknown' }, { ...job(), error: 'raw-secret' }, { ...job(), recipeId: 'b'.repeat(32) }, { ...job(), attempts: 4 }, { ...job(), state: 'failed' }, { ...job(), state: 'succeeded' }]) {
    invoke.mockResolvedValueOnce(invalid); await expect(api.get('a'.repeat(32))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  }
});
test('text_limit_uses_utf8_bytes_and_invalid_input_never_reaches_transport', async () => {
  const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => job()); const api = createImportsApi({ invoke: async <T>(...args: Parameters<Invoke>): Promise<T> => await invoke(...args) as T, boundary: createSessionBoundary(createMemoryStorage()) });
  const base = { requestId: 'imports-api-submit-01', familyId: 'home', generation: 'generation' };
  for (const text of ['', '\uD800', '字'.repeat(5462), 'bad\u0000text']) await expect(async () => api.submit({ ...base, source: { kind: 'text', text } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(invoke).not.toHaveBeenCalled();
  for (const mediaId of ['file', 'cloud://space/file.png', 'https://example.com/file.png']) await expect(async () => api.submit({ ...base, source: { kind: 'image', mediaId } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await api.submit({ ...base, source: { kind: 'text', text: '字'.repeat(5461) } }); expect(invoke).toHaveBeenCalledTimes(1);
});

test('url_source_reaches_transport_only_after_local_shape_validation', async () => {
  const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => job());
  const api = createImportsApi({ invoke: async <T>(...args: Parameters<Invoke>): Promise<T> => await invoke(...args) as T, boundary: createSessionBoundary(createMemoryStorage()) });
  const base = { requestId: 'imports-api-submit-url-01', familyId: 'home', generation: 'generation' };
  for (const url of ['', '   ', 'not a url', 'ftp://example.com/', 'https://user:pass@example.com/', 'https://example.com:8080/', 'http://localhost/', 'http://printer.local/', 'http://metadata.google.internal/', 'https://example.com/ recipe', 'https://' + 'a'.repeat(2048) + '.com/']) {
    await expect(async () => api.submit({ ...base, source: { kind: 'url', url } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  expect(invoke).not.toHaveBeenCalled();
  await api.submit({ ...base, source: { kind: 'url', url: ' https://example.com/recipe ' } });
  expect(invoke).toHaveBeenCalledWith('imports-co', 'submit', { ...base, source: { kind: 'url', url: 'https://example.com/recipe' } });
});

test('source_unreadable_job_error_is_accepted_by_the_wire_parser', async () => {
  const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ...job(), state: 'failed', error: 'SOURCE_UNREADABLE', updatedAt: 3 }));
  const api = createImportsApi({ invoke: async <T>(...args: Parameters<Invoke>): Promise<T> => await invoke(...args) as T, boundary: createSessionBoundary(createMemoryStorage()) });
  await expect(api.get('a'.repeat(32))).resolves.toMatchObject({ state: 'failed', error: 'SOURCE_UNREADABLE' });
});
