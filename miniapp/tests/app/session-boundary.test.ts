import { expect, test } from 'vitest';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createCloudClient } from '../../src/shared/cloud-client';
import { createAccountApi } from '../../src/features/auth/api';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { createAuthController } from '../../src/features/auth/use-auth';
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
test('late_sdk_refresh_cannot_restore_logout', async () => {
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); const old = deferCall();
  const cloud = createCloudClient({ boundary, transport: () => old.promise });
  const pending = cloud.invoke('recipe-co', 'get', {}).catch(() => null); await tick();
  const closing = boundary.close(async () => {}); void closing.catch(() => {}); expect(storage.get('home.auth.closed')).toBe(true);
  old.resolveWithNewToken(storage, 'old-alice'); await pending; await closing;
  expect(storage.get('uni_id_token')).toBeUndefined(); expect(storage.get('uni_id_token_expired')).toBeUndefined();
});
test('new_login_waits_for_old_calls_to_settle', async () => {
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); const old = deferCall(); let loginCalls = 0;
  const pending = boundary.run('business', () => old.promise).catch(() => null); await tick();
  const closing = boundary.close(async () => {});
  const login = boundary.login(async () => { loginCalls++; storage.set('uni_id_token', 'bob'); return { uid: 'bob' }; });
  void closing.catch(() => {}); void login.catch(() => {});
  await tick(); expect(loginCalls).toBe(0); old.resolveWithNewToken(storage, 'alice'); await pending; await closing;
  expect(await login).toEqual({ uid: 'bob' }); expect(storage.get('uni_id_token')).toBe('bob');
});
test('cold_start_respects_closed_marker', async () => {
  const storage = createMemoryStorage(); storage.set('home.auth.closed', true); storage.set('uni_id_token', 'residual');
  const boundary = createSessionBoundary(storage); let calls = 0;
  await expect(boundary.run('session', async () => { calls++; })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(calls).toBe(0); expect(storage.get('uni_id_token')).toBeUndefined();
});
test('closing_waits_for_entire_platform_login_flow_and_does_not_exchange_late_code', async () => {
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); const code = deferCall(); let exchanges = 0;
  const account = createAccountApi({ boundary, platformLogin: async () => { await code.promise; return 'late-code'; }, wire: { async loginByWeixin() { exchanges++; }, async session() { return { uid: 'alice' }; }, async logout() {} } });
  const pending = account.signInWeixin().catch(() => null); await tick(); let drained = false;
  const closing = account.signOut().then(() => { drained = true; }); await tick(); expect(drained).toBe(false);
  code.resolve(null); await pending; await closing; expect(exchanges).toBe(0); expect(storage.get('home.auth.closed')).toBe(true);
});
test('failed_session_after_login_clears_sdk_token', async () => {
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage);
  const cloud = createCloudClient({ boundary, transport: async (_object, method) => {
    if (method === 'loginByWeixin') { storage.set('uni_id_token', 'half-login'); return { errCode: 0 }; }
    return { errCode: 'AUTH_REQUIRED' };
  } });
  const api = createAccountApi({ wire: cloud.account, boundary, platformLogin: async () => 'test-code' });
  await expect(api.signInWeixin()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' }); expect(storage.get('uni_id_token')).toBeUndefined();
});
test('sdk_rejected_auth_envelope_is_auth_failure_not_network_failure', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'revoked');
  const boundary = createSessionBoundary(storage); const cloud = createCloudClient({ boundary, transport: async () => { throw { errCode: 'AUTH_REQUIRED', errMsg: 'SYNTHETIC-NOT-FOR-UI' }; } });
  const api = createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => 'unused' });
  await expect(api.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED', message: 'AUTH_REQUIRED' });
  expect(storage.get('uni_id_token')).toBeUndefined(); expect(storage.get('home.auth.closed')).toBe(true);
});
test('real_adapter_network_failure_keeps_token_but_conceals_identity', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'existing'); const boundary = createSessionBoundary(storage);
  const cloud = createCloudClient({ boundary, transport: async () => { throw { errCode: 'uni-cloud-network-error' }; } });
  const auth = createAuthController(createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => 'unused' }));
  expect(await auth.restore()).toBe(false); expect(auth.phase.value).toBe('unavailable'); expect(auth.identity.value).toBeNull(); expect(storage.get('uni_id_token')).toBe('existing');
});
test('old_controller_restore_cannot_repopulate_identity_after_logout', async () => {
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); const old = deferCall();
  const cloud = createCloudClient({ boundary, transport: async (_object, method) => method === 'session' ? old.promise : { errCode: 0 } });
  const auth = createAuthController(createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => 'unused' }));
  const restore = auth.restore(); await tick(); const closing = auth.signOut(); expect(auth.identity.value).toBeNull();
  old.resolveWithNewToken(storage, 'late-old'); await closing; await restore; expect(auth.identity.value).toBeNull(); expect(storage.get('uni_id_token')).toBeUndefined();
});
test('facade_close_hides_controller_and_clears_local_token_before_revoke_settles', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'submitted'); const boundary = createSessionBoundary(storage); const revoke = deferCall(); let submittedToken: unknown;
  const cloud = createCloudClient({ boundary, transport: async (_object, method) => {
    if (method === 'logout') { submittedToken = storage.get('uni_id_token'); return revoke.promise; } return { errCode: 0, data: { uid: 'alice' } };
  } });
  const api = createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => 'unused' }); const auth = createAuthController(api); await auth.restore();
  const closing = api.signOut(); expect(auth.identity.value).toBeNull(); expect(storage.get('uni_id_token')).toBeUndefined(); expect(submittedToken).toBe('submitted');
  revoke.resolve({ errCode: 0 }); await closing; expect(auth.phase.value).toBe('anonymous');
});
test('next_login_after_closing_old_entire_login_is_queued_not_shared_with_old_attempt', async () => {
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); const oldCode = deferCall(); let codes = 0; const exchanged: string[] = [];
  const cloud = createCloudClient({ boundary, transport: async (_object, method, input) => {
    if (method === 'loginByWeixin') exchanged.push((input as { code: string }).code);
    return { errCode: 0, data: { uid: 'bob' } };
  } });
  const api = createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => { codes++; if (codes === 1) { await oldCode.promise; return 'old-code'; } return 'new-code'; } });
  const first = api.signInWeixin().catch(() => null); await tick(); const closing = api.signOut(); const next = api.signInWeixin(); void next.catch(() => {});
  await tick(); expect(codes).toBe(1); oldCode.resolve(null); await first; await closing;
  expect(await next).toEqual({ uid: 'bob' }); expect(exchanged).toEqual(['new-code']);
});
