import type { Identity } from 'home-contracts';
import { AppError } from './errors';
export interface SessionStorage { get(key: string): unknown; set(key: string, value: unknown): void; remove(key: string): void }
export type CallKind = 'login' | 'session' | 'logout' | 'business';
export interface SessionBoundary {
  readonly closing: boolean; readonly epoch: number;
  run<T>(kind: CallKind, action: () => Promise<T>): Promise<T>;
  login(flow: () => Promise<Identity>): Promise<Identity>;
  close(revoke: () => Promise<void>): Promise<void>;
}
const closeObservers = new WeakMap<SessionBoundary, Set<(closing: boolean) => void>>();
// Internal notification seam; the public boundary/AccountApi contracts stay narrow.
export function observeBoundaryClosure(boundary: SessionBoundary, listener: (closing: boolean) => void): () => void {
  const listeners = closeObservers.get(boundary); listeners?.add(listener);
  return () => { listeners?.delete(listener); };
}
export function createSessionBoundary(storage: SessionStorage): SessionBoundary {
  let epoch = 0; let closed = storage.get('home.auth.closed') === true;
  let closing: Promise<void> | null = null; let loginAttempt: Promise<Identity> | null = null;
  let queuedLogin: Promise<Identity> | null = null;
  let activeFlow: Promise<Identity> | null = null; let flowEpoch: number | null = null; let revoking = false;
  const inFlight = new Set<Promise<unknown>>();
  const listeners = new Set<(closing: boolean) => void>();
  const notify = (closing: boolean) => { for (const listener of listeners) { try { listener(closing); } catch { /* Observers cannot prevent credential clearing/drain. */ } } };
  const clear = () => { storage.remove('uni_id_token'); storage.remove('uni_id_token_expired'); };
  if (closed) clear();
  const boundary: SessionBoundary = {
    get closing() { return closing !== null; }, get epoch() { return epoch; },
    async run<T>(kind: CallKind, action: () => Promise<T>): Promise<T> {
      const started = epoch;
      const inLogin = flowEpoch !== null && flowEpoch === epoch;
      if ((kind === 'logout' && !revoking) || (kind === 'login' && !inLogin)
        || (kind !== 'logout' && (closing || (closed && !(inLogin && (kind === 'login' || kind === 'session')))))) throw new AppError('AUTH_REQUIRED');
      // Register the actual transport Promise, never a raced timeout wrapper.
      const pending = action(); inFlight.add(pending);
      try {
        const result = await pending;
        if (started !== epoch && kind !== 'logout') throw new AppError('AUTH_REQUIRED');
        return result;
      } finally {
        inFlight.delete(pending);
        // SDK has already written newToken BEFORE resolving pending.
        if (started !== epoch || closing || (closed && !inLogin)) clear();
      }
    },
    login(flow) {
      if (closing) {
        if (!queuedLogin) queuedLogin = closing.catch(() => {}).then(() => { queuedLogin = null; return boundary.login(flow); });
        return queuedLogin;
      }
      if (loginAttempt) return loginAttempt;
      loginAttempt = (async () => {
        try {
          // The queued-login branch above waits for actual revoke/request drain.
          const started = epoch; flowEpoch = started;
          activeFlow = flow();
          const result = await activeFlow;
          if (epoch !== started || closing) throw new AppError('AUTH_REQUIRED');
          closed = false; storage.remove('home.auth.closed'); return result;
        } catch (error) {
          closed = true; storage.set('home.auth.closed', true); clear(); throw error;
        } finally { activeFlow = null; flowEpoch = null; loginAttempt = null; }
      })();
      return loginAttempt;
    },
    close(revoke) {
      if (closing) return closing;
      closed = true; storage.set('home.auth.closed', true); epoch++;
      notify(true);
      const oldFlow = activeFlow; let failure: unknown;
      revoking = true;
      // Start the authorized revoke while its request token is still present.
      let revoked: Promise<void>;
      try { revoked = revoke().catch(error => { failure = error; }); }
      catch (error) { failure = error; revoked = Promise.resolve(); }
      const oldCalls = [...inFlight];
      clear();
      closing = (async () => {
        try {
          await revoked; revoking = false; clear();
          await Promise.allSettled([...oldCalls, ...(oldFlow ? [oldFlow] : [])]);
          clear();
          if (failure) throw failure;
        } finally { revoking = false; clear(); closing = null; notify(false); }
      })();
      return closing;
    },
  };
  closeObservers.set(boundary, listeners);
  return boundary;
}
