// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import Login from '../../src/pages/account/login.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import { mountPage } from '../support/uni-stubs';
import { createHarness } from '../support/harness';
import { createAccountApi } from '../../src/features/auth/api';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import type { AppClient } from 'home-contracts';
import { copy } from '../../src/shared/copy';
const navigation: string[] = [];
beforeEach(() => { navigation.length = 0; vi.stubGlobal('uni', { reLaunch: ({ url }: { url: string }) => { navigation.push(url); } }); });
test('calls_weixin_then_server_session', async () => {
  const order: string[] = []; const boundary = createSessionBoundary(createMemoryStorage());
  const client = { account: createAccountApi({ boundary, platformLogin: async () => { order.push('weixin'); return 'short-code'; }, wire: {
    async loginByWeixin(code) { expect(code).toBe('short-code'); order.push('login'); }, async session() { order.push('session'); return { uid: 'alice' }; }, async logout() {},
  } }) };
  const page = mountPage(Login, { client }); await page.show(); await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
  expect(order.slice(-3)).toEqual(['weixin', 'login', 'session']); expect(navigation.at(-1)).toContain('family/onboarding');
});
test('redirects_on_expired_login', async () => {
  const page = mountPage(Onboarding, { client: createHarness().client('forged') }); await page.show();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation.at(-1)).toContain('account/login');
});
test('direct_entry_and_return_run_guard', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const page = mountPage(Onboarding, { client: h.client('alice') });
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); await page.show(); expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
  await page.hide(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); h.revokeToken('alice'); await page.show();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); await page.unload();
});
test('network_failure_hides_protected_content_without_revoking_token', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'existing');
  const client: AppClient = { account: { async session() { throw Object.assign(new Error('safe'), { code: 'UNAVAILABLE' }); }, async signInWeixin() { throw new Error('unused'); }, async signOut() {} } };
  const page = mountPage(Onboarding, { client }); await page.show();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(page.auth.phase.value).toBe('unavailable'); expect(storage.get('uni_id_token')).toBe('existing'); expect(navigation).toEqual([]);
});
test('clears_state_even_when_logout_fails', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice'); client.account.signOut = async () => { throw new Error('network'); };
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('[data-sign-out]').trigger('click'); await flushPromises();
  expect(page.auth.identity.value).toBeNull(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation.at(-1)).toContain('account/login');
});
test('login_double_tap_shares_one_attempt', async () => {
  const pending = deferCall(); let calls = 0;
  const client: AppClient = { account: { async signInWeixin() { calls++; await pending.promise; return { uid: 'alice' }; }, async session() { throw Object.assign(new Error('auth'), { code: 'AUTH_REQUIRED' }); }, async signOut() {} } };
  const page = mountPage(Login, { client }); await page.show();
  const first = page.auth.signIn(); const second = page.auth.signIn(); void first.catch(() => {}); void second.catch(() => {}); expect(first).toBe(second); expect(calls).toBe(1); pending.resolve(null); await first;
});
test('failed_login_shows_safe_retry_without_non_weixin_entry', async () => {
  const page = mountPage(Login, { client: createHarness().client('forged') }); await page.show();
  await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain(copy.denied); expect(page.wrapper.findAll('button')).toHaveLength(1);
  expect(page.wrapper.find('[data-sign-in]').attributes('disabled')).toBeUndefined();
});
