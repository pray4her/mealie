// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import Login from '../../src/pages/account/login.vue';
import Home from '../../src/pages/family/home.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import List from '../../src/pages/recipes/index.vue';
import Detail from '../../src/pages/recipes/detail.vue';
import Submit from '../../src/pages/imports/submit.vue';
import Status from '../../src/pages/imports/status.vue';
import Edit from '../../src/pages/recipes/edit.vue';
import Join from '../../src/pages/family/join.vue';
import Invite from '../../src/pages/family/invite.vue';
import Members from '../../src/pages/family/members.vue';
import { mountPage, nativeNavigation } from '../support/uni-stubs';
import { createHarness } from '../support/harness';
import { deferCall } from '../support/sdk-transport';
import { copy } from '../../src/shared/copy';

afterEach(() => vi.unstubAllGlobals());
function navigation(stack?: string[]) {
  const native = nativeNavigation(stack); vi.stubGlobal('uni', native.uni); vi.stubGlobal('getCurrentPages', native.getCurrentPages); return native;
}
async function clientWithFamily() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ name: '当前家庭', requestId: 'navigation-family-01' }); return { h, client };
}

test('restored_login_enters_the_recipe_tab_and_drops_the_login_stack', async () => {
  const native = navigation(); const { client } = await clientWithFamily(); const page = mountPage(Login, { client });
  await page.show(); expect(native.events).toEqual([{ kind: 'switchTab', url: '/pages/recipes/index' }]);
  expect(native.stack).toEqual(['/pages/recipes/index']); page.wrapper.unmount();
});

test('new_user_enters_guarded_onboarding_from_the_default_recipe_tab', async () => {
  const native = navigation(); const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const login = mountPage(Login, { client }); await login.show(); await login.hide();
  const recipes = mountPage(List, { client, controllers: login.controllers }); await recipes.show();
  expect(native.events).toEqual([{ kind: 'switchTab', url: '/pages/recipes/index' }, { kind: 'reLaunch', url: '/pages/family/onboarding' }]);
  expect(recipes.wrapper.find('[data-protected]').exists()).toBe(false);
  expect(native.stack).toEqual(['/pages/family/onboarding']); recipes.wrapper.unmount(); login.wrapper.unmount();
});

test('invitation_continuation_takes_priority_over_an_existing_family_on_login', async () => {
  const native = navigation(); const { client } = await clientWithFamily(); const page = mountPage(Login, { client });
  const invitation = await client.family.invite({ requestId: 'navigation-invite-01' });
  page.controllers.invitations.receive(invitation.token);
  await page.show(); expect(native.events).toEqual([{ kind: 'reLaunch', url: '/pages/family/join' }]); page.wrapper.unmount();
});

test('onboarding_with_an_existing_family_switches_to_recipes', async () => {
  const native = navigation(['/pages/family/onboarding']); const { client } = await clientWithFamily(); const page = mountPage(Onboarding, { client });
  await page.show(); expect(native.events).toEqual([{ kind: 'switchTab', url: '/pages/recipes/index' }]); page.wrapper.unmount();
});

test('family_to_recipes_switches_tabs_and_child_pages_use_the_native_stack', async () => {
  const native = navigation(['/pages/family/home']); const { client } = await clientWithFamily(); const home = mountPage(Home, { client });
  await home.show(); await home.wrapper.get('[data-recipes]').trigger('click');
  expect(native.events.at(-1)).toEqual({ kind: 'switchTab', url: '/pages/recipes/index' }); await home.hide();
  const recipes = mountPage(List, { client, controllers: home.controllers }); await recipes.show();
  await recipes.wrapper.get('[data-create]').trigger('click');
  expect(native.events.at(-1)).toEqual({ kind: 'navigateTo', url: '/pages/recipes/edit' });
  expect(native.stack).toEqual(['/pages/recipes/index', '/pages/recipes/edit']); recipes.wrapper.unmount(); home.wrapper.unmount();
});

test('recipes_to_family_uses_the_family_tab', async () => {
  const native = navigation(['/pages/recipes/index']); const { client } = await clientWithFamily(); const page = mountPage(List, { client });
  await page.show(); await page.wrapper.findAll('button').find(button => button.text() === copy.backHome)!.trigger('click');
  expect(native.events.at(-1)).toEqual({ kind: 'switchTab', url: '/pages/family/home' }); page.wrapper.unmount();
});

test.each([Detail, Edit, Submit, Status])('child_return_uses_native_stack_then_recipe_tab_for_direct_entry_%#', async component => {
  const native = navigation(['/pages/recipes/index', '/pages/recipes/detail?id=' + 'a'.repeat(32)]); const { client } = await clientWithFamily();
  const page = mountPage(component, { client });
  const back = () => page.wrapper.findAll('button').find(button => [copy.back, '返回菜谱'].includes(button.text()))!;
  await back().trigger('click'); expect(native.events.at(-1)).toEqual({ kind: 'navigateBack', url: '/pages/recipes/index' });
  native.stack.splice(0, native.stack.length, '/pages/recipes/detail?id=' + 'a'.repeat(32));
  await back().trigger('click'); expect(native.events.at(-1)).toEqual({ kind: 'switchTab', url: '/pages/recipes/index' }); page.wrapper.unmount();
});

test.each([Invite, Members])('family_child_return_preserves_stack_with_family_tab_fallback_%#', async component => {
  const native = navigation(['/pages/recipes/index', '/pages/family/members']); const { client } = await clientWithFamily(); const page = mountPage(component, { client });
  await page.show(); const back = () => page.wrapper.findAll('button').find(button => button.text() === copy.back)!;
  await back().trigger('click'); expect(native.events.at(-1)).toEqual({ kind: 'navigateBack', url: '/pages/recipes/index' });
  native.stack.splice(0, native.stack.length, '/pages/family/members');
  await back().trigger('click'); expect(native.events.at(-1)).toEqual({ kind: 'switchTab', url: '/pages/family/home' }); page.wrapper.unmount();
});

test('failed_native_back_falls_back_to_the_recipe_tab', async () => {
  const native = navigation(['/pages/recipes/index', '/pages/imports/submit']); const { client } = await clientWithFamily();
  vi.stubGlobal('uni', { ...native.uni, navigateBack: ({ fail }: { fail: () => void }) => fail() }); const page = mountPage(Submit, { client });
  await page.wrapper.findAll('button').find(button => button.text() === '返回菜谱')!.trigger('click');
  expect(native.stack).toEqual(['/pages/recipes/index']); page.wrapper.unmount();
});

test('create_and_join_finish_on_recipes_without_leaving_onboarding_in_the_stack', async () => {
  const native = navigation(['/pages/family/onboarding']); const h = createHarness();
  for (const uid of ['alice', 'bob']) await h.seedIdentity({ uid }); const alice = h.client('alice'); const page = mountPage(Onboarding, { client: alice });
  await page.show(); await page.wrapper.get('input').setValue('新家庭'); await page.wrapper.get('[data-create]').trigger('click'); await flushPromises();
  expect(native.events.at(-1)).toEqual({ kind: 'switchTab', url: '/pages/recipes/index' }); page.wrapper.unmount();
  const invitation = await alice.family.invite({ requestId: 'navigation-invite-02' }); native.stack.splice(0, native.stack.length, '/pages/family/join');
  const join = mountPage(Join, { client: h.client('bob') }); await join.load({ token: invitation.token }); await join.show();
  await join.wrapper.get('[data-confirm-join]').trigger('click'); await flushPromises();
  expect(native.events.at(-1)).toEqual({ kind: 'switchTab', url: '/pages/recipes/index' }); expect(native.stack).toEqual(['/pages/recipes/index']); join.wrapper.unmount();
});

test('unauthenticated_deep_entry_clears_all_protected_pages', async () => {
  const native = navigation(['/pages/recipes/index', '/pages/recipes/detail?id=' + 'a'.repeat(32)]);
  const page = mountPage(Detail, { client: createHarness().client('forged') }); await page.load({ id: 'a'.repeat(32) }); await page.show();
  expect(native.stack).toEqual(['/pages/account/login']); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test('signout_clears_children_and_cannot_return_to_protected_tabs', async () => {
  const native = navigation(['/pages/recipes/index', '/pages/family/home']); const { client } = await clientWithFamily(); const page = mountPage(Home, { client });
  await page.show(); await page.wrapper.get('[data-sign-out]').trigger('click'); await flushPromises();
  expect(native.stack).toEqual(['/pages/account/login']); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test('a_hidden_recipe_tab_cannot_restore_a_late_response_after_switching_to_family', async () => {
  navigation(['/pages/recipes/index']); const { client } = await clientWithFamily(); const gate = deferCall(); const list = client.recipes.list;
  vi.spyOn(client.recipes, 'list').mockImplementationOnce(async input => { const result = await list(input); await gate.promise; return result; });
  const recipes = mountPage(List, { client }); const showing = recipes.show(); await flushPromises(); await recipes.hide();
  const home = mountPage(Home, { client, controllers: recipes.controllers }); await home.show(); gate.resolve(null); await showing;
  expect(recipes.wrapper.find('[data-protected]').exists()).toBe(false); expect(home.wrapper.text()).toContain('当前家庭');
  await home.hide(); await recipes.show(); expect(recipes.wrapper.find('[data-protected]').exists()).toBe(true);
  home.wrapper.unmount(); recipes.wrapper.unmount();
});
