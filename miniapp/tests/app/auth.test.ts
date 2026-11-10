// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h as render } from 'vue';
import { useAppClient } from '../../src/shared/app-client';
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
beforeEach(() => { navigation.length = 0; vi.stubGlobal('uni', { switchTab: ({ url }: { url: string }) => navigation.push(url), reLaunch: ({ url }: { url: string }) => { navigation.push(url); } }); });
async function signedOutClient(signInWeixin: AppClient['account']['signInWeixin']): Promise<AppClient> {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice'); let signedIn = false;
  return { ...client, account: { ...client.account,
    async signInWeixin() { const identity = await signInWeixin(); signedIn = true; return identity; },
    async session() { if (!signedIn) throw Object.assign(new Error('auth'), { code: 'AUTH_REQUIRED' }); return { uid: 'alice' }; },
  } };
}
test('calls_weixin_then_server_session', async () => {
  const order: string[] = []; const boundary = createSessionBoundary(createMemoryStorage());
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const client = { ...h.client('alice'), account: createAccountApi({ boundary, platformLogin: async () => { order.push('weixin'); return 'short-code'; }, wire: {
    async loginByWeixin(code) { expect(code).toBe('short-code'); order.push('login'); }, async session() { order.push('session'); return { uid: 'alice' }; }, async logout() {},
  } }) };
  const page = mountPage(Login, { client }); await page.show(); await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
  const start = order.indexOf('weixin'); expect(order.slice(start, start + 3)).toEqual(['weixin', 'login', 'session']); expect(navigation.at(-1)).toContain('family/onboarding');
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
  const client: AppClient = { ...createHarness().client('alice'), account: { async session() { throw Object.assign(new Error('safe'), { code: 'UNAVAILABLE' }); }, async signInWeixin() { throw new Error('unused'); }, async signOut() {} } };
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
  const client: AppClient = { ...createHarness().client('alice'), account: { async signInWeixin() { calls++; await pending.promise; return { uid: 'alice' }; }, async session() { throw Object.assign(new Error('auth'), { code: 'AUTH_REQUIRED' }); }, async signOut() {} } };
  const page = mountPage(Login, { client }); await page.show();
  const first = page.auth.signIn(); const second = page.auth.signIn(); void first.catch(() => {}); void second.catch(() => {}); expect(first).toBe(second); expect(calls).toBe(1); pending.resolve(null); await first;
});
test('failed_login_shows_safe_retry_without_non_weixin_entry', async () => {
  const page = mountPage(Login, { client: createHarness().client('forged') }); await page.show();
  await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain(copy.denied); expect(page.wrapper.findAll('button')).toHaveLength(1);
  expect(page.wrapper.find('[data-sign-in]').attributes('disabled')).toBeUndefined();
});
test('mounted_pages_share_the_application_auth_and_family_controller', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const Page = defineComponent({ setup() {
    const { auth, family } = useAppClient();
    return () => render('span', `${auth.identity.value?.uid ?? ''}:${family.view.value?.name ?? ''}`);
  } });
  const page = mountPage(Page, { client: h.client('alice') });
  await page.family.load(); await page.family.submit('家'); await flushPromises();
  expect(page.wrapper.text()).toBe('alice:家');
  await page.auth.signOut(); await flushPromises(); expect(page.wrapper.text()).toBe(':');
  page.wrapper.unmount();
});

test('login_hidden_then_shown_does_not_run_the_previous_show_navigation', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const gate = deferCall(); const session = client.account.session;
  client.account.session = async () => { await gate.promise; return session(); };
  const page = mountPage(Login, { client }); const first = page.show(); await page.hide(); const second = page.show();
  gate.resolve(null); await Promise.all([first, second]); expect(navigation).toEqual(['/pages/family/onboarding']); page.wrapper.unmount();
});

test('current_login_show_finishes_pending_sign_in_once_after_repeated_hide_and_show', async () => {
  const gate = deferCall(); const signIn = vi.fn(async () => { await gate.promise; return { uid: 'alice' }; });
  const client = await signedOutClient(signIn);
  const page = mountPage(Login, { client }); await page.show(); await page.wrapper.find('[data-sign-in]').trigger('click');
  await page.hide(); const first = page.show(); await flushPromises(); await page.hide();
  const second = page.show(); const overlapping = page.show(); await flushPromises();
  expect(navigation).toEqual([]); gate.resolve(null); await Promise.all([first, second, overlapping]); await flushPromises();
  expect(page.auth.identity.value?.uid).toBe('alice'); expect(signIn).toHaveBeenCalledTimes(1);
  expect(navigation).toEqual(['/pages/family/onboarding']); page.wrapper.unmount();
});

test.each(['hide', 'unload'] as const)('pending_sign_in_cannot_navigate_after_current_show_%s', async lifecycle => {
  const gate = deferCall();
  const client: AppClient = { ...createHarness().client('alice'), account: {
    async signInWeixin() { await gate.promise; return { uid: 'alice' }; },
    async session() { throw Object.assign(new Error('auth'), { code: 'AUTH_REQUIRED' }); }, async signOut() {},
  } };
  const page = mountPage(Login, { client }); await page.show(); await page.wrapper.find('[data-sign-in]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises(); await page[lifecycle]();
  gate.resolve(null); await showing; expect(navigation).toEqual([]); page.wrapper.unmount();
});

test.each(['AUTH_REQUIRED', 'UNAVAILABLE'])('pending_sign_in_failure_after_new_show_remains_retryable_%s', async code => {
  const gate = deferCall(); const signIn = vi.fn(async () => ({ uid: 'alice' }))
    .mockImplementationOnce(async () => { await gate.promise; throw Object.assign(new Error('safe'), { code }); });
  const client = await signedOutClient(signIn);
  const page = mountPage(Login, { client }); await page.show(); await page.wrapper.find('[data-sign-in]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises(); gate.resolve(null); await showing;
  const button = page.wrapper.find('[data-sign-in]'); expect(button.attributes('disabled')).toBeUndefined();
  expect(button.text()).toBe(copy.retrySignIn); expect(navigation).toEqual([]);
  await button.trigger('click'); await flushPromises();
  expect(signIn).toHaveBeenCalledTimes(2); expect(navigation).toEqual(['/pages/family/onboarding']); page.wrapper.unmount();
});

test('pending_sign_in_for_previous_uid_cannot_route_current_show', async () => {
  const gate = deferCall(); const signIn = vi.fn(async () => ({ uid: 'bob' }))
    .mockImplementationOnce(async () => { await gate.promise; return { uid: 'alice' }; });
  const client: AppClient = { ...createHarness().client('alice'), account: {
    signInWeixin: signIn, async session() { throw Object.assign(new Error('auth'), { code: 'AUTH_REQUIRED' }); }, async signOut() {},
  } };
  const page = mountPage(Login, { client }); await page.show(); await page.wrapper.find('[data-sign-in]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises();
  await page.auth.signOut(); await page.auth.signIn(); gate.resolve(null); await showing;
  expect(page.auth.identity.value?.uid).toBe('bob'); expect(navigation).toEqual([]); page.wrapper.unmount();
});
