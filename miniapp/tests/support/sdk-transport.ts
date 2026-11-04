import type { SessionStorage } from '../../src/shared/session-boundary';
export function createMemoryStorage() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); }, remove: (key: string) => { values.delete(key); } } satisfies SessionStorage;
}
export function deferCall() {
  let resolve!: (value: unknown) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return {
    promise, reject, resolve,
    resolveWithNewToken(storage: SessionStorage, token: string, data: unknown = { uid: 'alice' }) {
      // This ordering is the contract under test: SDK storage write PRECEDES Promise resolution.
      storage.set('uni_id_token', token); storage.set('uni_id_token_expired', 2_000_000_000_000);
      resolve({ errCode: 0, data, newToken: { token, tokenExpired: 2_000_000_000_000 } });
    },
  };
}
