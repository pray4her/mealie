import { describe, expect, test } from 'vitest';
import { createHarness } from '../support/harness';

describe('identity', () => {
  test('rejects_missing_or_forged_token', async () => {
    const h = createHarness();
    for (const uid of ['', 'forged']) await expect(h.client(uid).account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
  test('returns_only_identity', async () => {
    const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
    expect(await h.client('alice').account.session()).toEqual({ uid: 'alice' });
  });
  test('rejects_expired_token', async () => {
    const h = createHarness({ now: 200_000 }); await h.seedIdentity({ uid: 'alice', expiresAtSeconds: 200 });
    await expect(h.client('alice').account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(h.refreshCalls).toBe(0);
  });
  test('rejects_revoked_token_before_refresh', async () => {
    const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); h.revokeToken('alice');
    await expect(h.client('alice').account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(h.refreshCalls).toBe(0);
  });
  test('rejects_disabled_or_closed_account', async () => {
    for (const status of [1, 2, 3, 4]) {
      const h = createHarness(); await h.seedIdentity({ uid: 'alice', status });
      await expect(h.client('alice').account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(h.refreshCalls).toBe(0);
    }
    const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); h.closeAccount('alice');
    await expect(h.client('alice').account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(h.refreshCalls).toBe(0);
  });
  test('checks_valid_token_date_in_milliseconds', async () => {
    const h = createHarness({ now: 200_000 }); await h.seedIdentity({ uid: 'alice', issuedAtSeconds: 100, validTokenDateMs: 100_001 });
    await expect(h.client('alice').account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(h.refreshCalls).toBe(0);
    await h.seedIdentity({ uid: 'alice', issuedAtSeconds: 100, validTokenDateMs: 100_000 });
    expect(await h.client('alice').account.session()).toEqual({ uid: 'alice' });
  });
  test('accepts_missing_or_zero_status', async () => {
    for (const status of [undefined, 0]) { const h = createHarness(); await h.seedIdentity({ uid: 'alice', status }); expect(await h.client('alice').account.session()).toEqual({ uid: 'alice' }); }
  });
  test('logout_does_not_refresh_near_threshold', async () => {
    const h = createHarness({ now: 200_000 }); await h.seedIdentity({ uid: 'alice', expiresAtSeconds: 201 });
    await h.client('alice').account.signOut(); expect(h.refreshCalls).toBe(0);
    await expect(h.client('alice').account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
