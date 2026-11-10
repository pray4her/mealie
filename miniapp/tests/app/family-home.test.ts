// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import Home from '../../src/pages/family/home.vue';
import { mountPage } from '../support/uni-stubs';
import { createHarness } from '../support/harness';
import Onboarding from '../../src/pages/family/onboarding.vue';
import { AppError } from '../../src/shared/errors';
import { flushPromises } from '@vue/test-utils';
import { deferCall } from '../support/sdk-transport';
import { familyFixture } from '../support/family-fixtures';
import { createRouteGuard } from '../../src/shared/route-guard';
import type { AppClient } from 'home-contracts';

const navigation: string[] = [];
beforeEach(() => { navigation.length = 0; vi.stubGlobal('uni', { reLaunch: ({ url }: { url: string }) => { navigation.push(url); } }); });
test('home_rechecks_current_before_showing_name_and_own_role', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const client = h.client('alice'); await client.family.create({ name: '家常饭', requestId: 'home-test-request-01' });
  const page = mountPage(Home, { client }); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  await page.show(); expect(page.wrapper.text()).toContain('家常饭'); expect(page.wrapper.text()).toContain('家庭所有者');
  expect(page.wrapper.find('[data-sign-out]').exists()).toBe(true); expect(page.wrapper.find('[data-invite]').exists()).toBe(true); expect(navigation).toEqual([]);
  await page.hide(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  page.wrapper.unmount();
});

test.each([Home, Onboarding])('failed_current_hides_protected_state_and_offers_retry_and_logout_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const current = vi.spyOn(client.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(component, { client }); await page.show();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(page.wrapper.find('[data-family-form]').exists()).toBe(false);
  expect(page.wrapper.text()).toContain('暂时无法确认家庭信息，请重试。');
  expect(page.wrapper.find('[data-sign-out]').exists()).toBe(true); expect(navigation).toEqual([]);
  await page.wrapper.find('[data-retry]').trigger('click'); await flushPromises(); expect(current).toHaveBeenCalledTimes(2);
  if (component === Home) expect(navigation).toEqual(['/pages/family/onboarding']);
  else expect(page.wrapper.find('[data-family-form]').exists()).toBe(true);
  page.wrapper.unmount();
});

test('member_home_shows_the_callers_role_and_members_but_no_invitation_management', async () => {
  const { h } = await familyFixture(); const page = mountPage(Home, { client: h.client('member') }); await page.show();
  expect(page.wrapper.text()).toContain('家庭成员'); expect(page.wrapper.text()).not.toContain('家庭所有者');
  expect(page.wrapper.find('[data-sign-out]').exists()).toBe(true); expect(page.wrapper.find('[data-members]').exists()).toBe(true); expect(page.wrapper.find('[data-invite]').exists()).toBe(false); expect(navigation).toEqual([]); page.wrapper.unmount();
});

test.each([Home, Onboarding])('unauthenticated_direct_entry_goes_to_login_%#', async component => {
  const page = mountPage(component, { client: createHarness().client('forged') }); await page.show();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation).toEqual(['/pages/account/login']); page.wrapper.unmount();
});

test('existing_family_onboarding_redirects_once_and_home_does_not_redirect_back', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ name: '家', requestId: 'existing-home-request' });
  const onboarding = mountPage(Onboarding, { client }); await onboarding.show(); expect(navigation).toEqual(['/pages/family/home']);
  expect(onboarding.wrapper.find('[data-family-form]').exists()).toBe(false); await onboarding.hide();
  const home = mountPage(Home, { client }); await home.show(); expect(navigation).toEqual(['/pages/family/home']);
  onboarding.wrapper.unmount(); home.wrapper.unmount();
});

test('no_family_home_redirects_once_and_onboarding_stays_for_creation', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const home = mountPage(Home, { client }); await home.show(); expect(navigation).toEqual(['/pages/family/onboarding']);
  await home.hide(); const onboarding = mountPage(Onboarding, { client }); await onboarding.show();
  expect(onboarding.wrapper.find('[data-family-form]').exists()).toBe(true); expect(navigation).toEqual(['/pages/family/onboarding']);
  home.wrapper.unmount(); onboarding.wrapper.unmount();
});

test('home_return_query_failure_removes_old_name_and_success_restores_current_name', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ name: '可见的家', requestId: 'home-return-request1' });
  const page = mountPage(Home, { client }); await page.show(); expect(page.wrapper.text()).toContain('可见的家'); await page.hide();
  vi.spyOn(client.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE')); await page.show();
  expect(page.wrapper.text()).not.toContain('可见的家'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  await page.wrapper.find('[data-retry]').trigger('click'); await flushPromises(); expect(page.wrapper.text()).toContain('可见的家');
  page.wrapper.unmount();
});

test.each([Home, Onboarding])('old_show_cannot_navigate_after_hide_and_new_show_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  // Both cancelled loads return null; only phase=ready may confirm absence.
  const gate = deferCall(); const session = client.account.session;
  vi.spyOn(client.account, 'session').mockImplementationOnce(async () => { await gate.promise; return session(); });
  const current = vi.spyOn(client.family, 'current'); const page = mountPage(component, { client });
  const first = page.show(); await page.hide(); const second = page.show(); gate.resolve(null); await Promise.all([first, second]);
  expect(current).toHaveBeenCalledTimes(1);
  expect(navigation).toEqual(component === Home ? ['/pages/family/onboarding'] : []); page.wrapper.unmount();
});

test.each([Home, Onboarding])('hidden_and_unloaded_query_cannot_reveal_or_navigate_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const gate = deferCall(); const current = client.family.current;
  vi.spyOn(client.family, 'current').mockImplementationOnce(async () => { await gate.promise; return current(); });
  const page = mountPage(component, { client }); const showing = page.show(); await flushPromises(); await page.hide(); await page.unload();
  gate.resolve(null); await showing; expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation).toEqual([]); page.wrapper.unmount();
});

test('guard_without_family_fails_closed_and_legacy_auth_guard_still_works', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const page = mountPage(Home, { client: h.client('alice') });
  const guard = createRouteGuard(page.auth, url => navigation.push(url));
  expect(await guard.ensureFamily('onboarding')).toBe(false); expect(navigation).toEqual([]);
  expect(await guard.ensureAuthenticated()).toBe(true); expect(navigation).toEqual([]); page.wrapper.unmount();
});

test.each([Home, Onboarding])('query_failure_still_allows_local_logout_when_remote_logout_fails_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  vi.spyOn(client.family, 'current').mockRejectedValue(new AppError('UNAVAILABLE')); vi.spyOn(client.account, 'signOut').mockRejectedValue(new AppError('UNAVAILABLE'));
  const page = mountPage(component, { client }); await page.show(); await page.wrapper.find('[data-sign-out]').trigger('click'); await flushPromises();
  expect(page.auth.identity.value).toBeNull(); expect(page.family.view.value).toBeNull(); expect(navigation).toEqual(['/pages/account/login']); page.wrapper.unmount();
});

test('old_page_unload_cannot_clear_the_new_pages_shared_family_result', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const old = mountPage(Onboarding, { client }); await old.show(); await old.hide();
  await client.family.create({ name: '新页面的家', requestId: 'shared-home-request1' });
  const home = mountPage(Home, { client, controllers: old.controllers }); await home.show();
  await old.unload(); expect(home.wrapper.text()).toContain('新页面的家');
  expect(home.family.view.value?.name).toBe('新页面的家'); await home.show(); expect(home.wrapper.text()).toContain('新页面的家');
  home.wrapper.unmount(); old.wrapper.unmount();
});

test.each([Home, Onboarding])('current_page_recovers_when_logout_settles_after_hide_and_new_show_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  if (component === Home) await client.family.create({ name: '家', requestId: 'logout-home-request1' });
  const gate = deferCall(); const logout = client.account.signOut;
  vi.spyOn(client.account, 'signOut').mockImplementationOnce(async () => { await gate.promise; await logout(); });
  const page = mountPage(component, { client }); await page.show(); await page.wrapper.find('[data-sign-out]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises();
  expect(navigation).toEqual([]); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  gate.resolve(null); await showing; await flushPromises();
  expect(page.auth.phase.value).toBe('anonymous'); expect(navigation).toEqual(['/pages/account/login']);
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test.each([Home, Onboarding])('logout_completion_from_previous_uid_cannot_navigate_current_page_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); await h.seedIdentity({ uid: 'bob' });
  const alice = h.client('alice'); const bob = h.client('bob');
  if (component === Home) {
    await alice.family.create({ name: 'Alice家', requestId: 'alice-logout-request' });
    await bob.family.create({ name: 'Bob家', requestId: 'bob-logout-request-1' });
  }
  let selected = alice; const gate = deferCall();
  const client: AppClient = { media: selected.media, recipes: selected.recipes, account: {
    session: () => selected.account.session(), signInWeixin: () => selected.account.signInWeixin(),
    async signOut() { const account = selected.account; await gate.promise; await account.signOut(); },
  }, family: { ...selected.family, current: () => selected.family.current(), create: input => selected.family.create(input) } };
  const page = mountPage(component, { client }); await page.show(); await page.wrapper.find('[data-sign-out]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises();
  // The page's UID fence also covers plain account facades used outside the SDK boundary.
  selected = bob; await page.auth.signIn(); gate.resolve(null); await showing; await flushPromises();
  expect(navigation).toEqual([]); expect(page.wrapper.text()).not.toContain('Alice家');
  await page.show(); expect(page.auth.identity.value?.uid).toBe('bob'); expect(navigation).toEqual([]); page.wrapper.unmount();
});

test.each([Home, Onboarding])('current_page_recovers_after_pending_remote_logout_rejects_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  if (component === Home) await client.family.create({ name: '家', requestId: 'logout-failed-request' });
  const gate = deferCall();
  vi.spyOn(client.account, 'signOut').mockImplementationOnce(async () => { await gate.promise; throw new AppError('UNAVAILABLE'); });
  const page = mountPage(component, { client }); await page.show(); await page.wrapper.find('[data-sign-out]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises(); gate.resolve(null); await showing;
  expect(page.auth.phase.value).toBe('anonymous'); expect(navigation).toEqual(['/pages/account/login']);
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test.each([Home, Onboarding])('pending_logout_cannot_resume_hidden_or_unloaded_show_%#', async component => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  if (component === Home) await client.family.create({ name: '家', requestId: 'logout-hidden-request' });
  const gate = deferCall(); const logout = client.account.signOut;
  vi.spyOn(client.account, 'signOut').mockImplementationOnce(async () => { await gate.promise; await logout(); });
  const page = mountPage(component, { client }); await page.show(); await page.wrapper.find('[data-sign-out]').trigger('click');
  await page.hide(); const showing = page.show(); await flushPromises(); await page.hide(); await page.unload();
  gate.resolve(null); await showing;
  expect(navigation).toEqual([]); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});
