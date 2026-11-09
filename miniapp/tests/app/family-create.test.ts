// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createApp } from 'vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import { mountPage } from '../support/uni-stubs';
import { createHarness } from '../support/harness';
import { copy } from '../../src/shared/copy';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { AppError } from '../../src/shared/errors';
import { createFamilyIntentStore, newRequestId } from '../../src/features/family/intents';
import { provideAppClient } from '../../src/shared/app-client';
import type { AppClient } from 'home-contracts';

const navigation: string[] = [];
beforeEach(() => { navigation.length = 0; vi.stubGlobal('uni', { reLaunch: ({ url }: { url: string }) => { navigation.push(url); } }); });
afterEach(() => { vi.unstubAllGlobals(); });

test('confirmed_no_family_can_create_trimmed_name_and_enter_home', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const current = vi.spyOn(client.family, 'current'); const session = vi.spyOn(client.account, 'session');
  const page = mountPage(Onboarding, { client });
  expect(page.wrapper.find('[data-family-form]').exists()).toBe(false);
  await page.show(); expect(page.wrapper.find('[data-family-form]').exists()).toBe(true);
  expect(current).toHaveBeenCalledTimes(1); expect(session).toHaveBeenCalledTimes(1);
  await page.wrapper.find('input').setValue('  我们家  ');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(navigation).toEqual(['/pages/family/home']);
  expect(page.wrapper.find('[data-family-form]').exists()).toBe(false);
  expect(await client.family.current()).toMatchObject({ name: '我们家', role: 'owner' });
  page.wrapper.unmount();
});

test.each(['random', 'storage'] as const)('pre_send_%s_failure_keeps_the_form_editable_and_does_not_claim_an_unknown_creation', async failure => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const create = vi.spyOn(client.family, 'create'); const storage = createMemoryStorage();
  if (failure === 'storage') vi.spyOn(storage, 'set').mockImplementation(() => { throw new Error('storage unavailable'); });
  vi.stubGlobal('wx', { getRandomValues(options: { success(result: { randomValues: ArrayBuffer }): void; fail(): void }) {
    queueMicrotask(() => {
      if (failure === 'random') options.fail(); else options.success({ randomValues: new ArrayBuffer(16) });
    });
  } });
  const controllers = provideAppClient(createApp({}), client, { storage, newRequestId });
  const page = mountPage(Onboarding, { client, controllers });
  try {
    await page.show(); await page.wrapper.find('input').setValue('尚未提交的家');
    await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
    expect(create).not.toHaveBeenCalled(); expect(page.family.pending.value).toBeNull();
    expect(createFamilyIntentStore(storage).read('alice')).toBeNull();
    expect(page.wrapper.find('input').attributes('disabled')).toBeUndefined();
    expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe('尚未提交的家');
    expect(page.wrapper.find('[data-create]').attributes('disabled')).toBeUndefined();
    expect(page.wrapper.find('[data-resume]').exists()).toBe(false);
    expect(page.wrapper.text()).toContain('暂时无法准备创建请求，请重试。');
    expect(page.wrapper.text()).not.toContain(copy.familyErrors.UNAVAILABLE);
    expect(navigation).toEqual([]);
  } finally { controllers.family.dispose(); page.wrapper.unmount(); }
});

test('unicode_validation_shows_chinese_feedback_and_accepts_40_non_bmp_characters', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const create = vi.spyOn(client.family, 'create'); const page = mountPage(Onboarding, { client }); await page.show();
  const input = page.wrapper.find('input'); expect(Number(input.attributes('maxlength'))).toBeGreaterThanOrEqual(80);
  for (const invalid of ['   ', '字'.repeat(41), 'a\u0001b']) {
    await input.setValue(invalid); await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
    expect(page.wrapper.text()).toContain('家庭名称需为1至40个字，且不能包含控制字符。'); expect(create).not.toHaveBeenCalled();
  }
  await input.setValue('🍲'.repeat(40)); await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(create).toHaveBeenCalledTimes(1); expect(navigation).toEqual(['/pages/family/home']); page.wrapper.unmount();
});

test('double_tap_creates_once_disables_input_and_navigates_once', async () => {
  const audit = deferCall(); const h = createHarness({ content: { async checkText() { await audit.promise; return 'allowed'; } } });
  await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice'); const create = vi.spyOn(client.family, 'create');
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('家');
  const button = page.wrapper.find('[data-create]'); await Promise.all([button.trigger('click'), button.trigger('click')]); await flushPromises();
  expect(create).toHaveBeenCalledTimes(1); expect(button.attributes('disabled')).toBeDefined(); expect(page.wrapper.find('input').attributes('disabled')).toBeDefined();
  audit.resolve(null); await flushPromises(); expect(navigation).toEqual(['/pages/family/home']); page.wrapper.unmount();
});

test('unknown_result_keeps_name_locked_and_retries_the_same_intent', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const create = vi.spyOn(client.family, 'create').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('原来的家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('上次创建结果尚未确认，请恢复原来的家庭。');
  expect(page.wrapper.find('input').attributes('disabled')).toBeDefined(); expect(page.wrapper.find('[data-create]').exists()).toBe(false);
  await page.wrapper.find('[data-resume]').trigger('click'); await flushPromises();
  expect(create).toHaveBeenCalledTimes(2); expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  expect(navigation).toEqual(['/pages/family/home']); page.wrapper.unmount();
});

test('cold_start_restores_saved_name_and_request_before_offering_resume', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const storage = createMemoryStorage(); createFamilyIntentStore(storage).write('alice', { requestId: 'cold-start-request-01', name: '上次的家', uncertain: true });
  const create = vi.spyOn(client.family, 'create'); const page = mountPage(Onboarding, { client, storage }); await page.show();
  expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe('上次的家'); expect(page.wrapper.find('input').attributes('disabled')).toBeDefined();
  await page.wrapper.find('[data-resume]').trigger('click'); await flushPromises();
  expect(create).toHaveBeenCalledWith({ requestId: 'cold-start-request-01', name: '上次的家' }); expect(navigation).toEqual(['/pages/family/home']); page.wrapper.unmount();
});

test.each([
  ['INVALID_INPUT', '家庭名称不符合要求，请修改后重试。'],
  ['QUOTA_EXCEEDED', '操作过于频繁，请稍后再试。'],
  ['CONFLICT', '上次创建信息存在冲突，请重新确认家庭状态。'],
  ['FORBIDDEN', '当前无法创建家庭，请重新确认家庭状态。'],
] as const)('create_%s_shows_specific_safe_feedback', async (code, text) => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  vi.spyOn(client.family, 'create').mockRejectedValueOnce(new AppError(code));
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain(text); expect(page.wrapper.text()).not.toMatch(/requestId|payloadHash|云模块|UNAVAILABLE|CONFLICT/);
  if (code === 'INVALID_INPUT') { expect(page.wrapper.find('input').attributes('disabled')).toBeUndefined(); expect(page.wrapper.find('[data-create]').exists()).toBe(true); }
  if (code === 'CONFLICT' || code === 'FORBIDDEN') expect(page.wrapper.find('[data-retry]').exists()).toBe(true);
  expect(navigation).toEqual([]); page.wrapper.unmount();
});

test('create_authentication_rejection_returns_to_login_and_hides_form', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  vi.spyOn(client.family, 'create').mockRejectedValueOnce(new AppError('AUTH_REQUIRED'));
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation).toEqual(['/pages/account/login']); page.wrapper.unmount();
});

test('same_page_new_account_does_not_inherit_draft_or_validation_error', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); await h.seedIdentity({ uid: 'bob' });
  let selected = h.client('alice');
  const client: AppClient = { recipes: selected.recipes, account: {
    session: () => selected.account.session(), signInWeixin: () => selected.account.signInWeixin(), signOut: () => selected.account.signOut(),
  }, family: { ...selected.family, current: () => selected.family.current(), create: input => selected.family.create(input) } };
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('Alice未提交的名字');
  // An external authentication refresh can change accounts on this same page instance.
  selected = h.client('bob'); await page.auth.restore(); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  await page.show(); expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe('');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises(); expect(page.wrapper.text()).toContain(copy.invalidFamilyName);
  selected = h.client('alice'); await page.show(); expect(page.wrapper.text()).not.toContain(copy.invalidFamilyName);
  expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe(''); page.wrapper.unmount();
});

test('return_after_hidden_create_rechecks_and_unlocks_recovery_without_old_navigation', async () => {
  const gate = deferCall(); const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const create = client.family.create; vi.spyOn(client.family, 'create').mockImplementationOnce(async input => { await gate.promise; return create(input); });
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('原来的家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises(); await page.hide();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); await page.show();
  expect(page.wrapper.find('[data-resume]').attributes('disabled')).toBeUndefined();
  gate.resolve(null); await flushPromises(); expect(navigation).toEqual([]);
  await page.show(); expect(navigation).toEqual(['/pages/family/home']); page.wrapper.unmount();
});

test.each(['hide', 'unload', 'signOut'] as const)('late_create_after_%s_cannot_restore_or_navigate', async action => {
  const gate = deferCall(); const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const create = client.family.create;
  vi.spyOn(client.family, 'create').mockImplementationOnce(async input => { const result = await create(input); await gate.promise; return result; });
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('旧家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  if (action === 'signOut') { await page.wrapper.find('[data-sign-out]').trigger('click'); await flushPromises(); }
  else await page[action]();
  const before = [...navigation]; gate.resolve(null); await flushPromises(); expect(navigation).toEqual(before);
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test('old_account_create_cannot_navigate_or_overwrite_new_account_on_same_page', async () => {
  const gate = deferCall(); const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); await h.seedIdentity({ uid: 'bob' });
  const alice = h.client('alice'); const bob = h.client('bob'); const create = alice.family.create;
  vi.spyOn(alice.family, 'create').mockImplementationOnce(async input => { const result = await create(input); await gate.promise; return result; });
  let selected = alice; const client: AppClient = { recipes: selected.recipes, account: {
    session: () => selected.account.session(), signInWeixin: () => selected.account.signInWeixin(), signOut: () => selected.account.signOut(),
  }, family: { ...selected.family, current: () => selected.family.current(), create: input => selected.family.create(input) } };
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('Alice家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  await page.hide(); selected = bob; await page.show(); expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe('');
  gate.resolve(null); await flushPromises(); expect(navigation).toEqual([]); expect(page.wrapper.text()).not.toContain('Alice家');
  await page.wrapper.find('input').setValue('Bob家'); await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(navigation).toEqual(['/pages/family/home']); expect(page.family.view.value).toMatchObject({ uid: 'bob', name: 'Bob家' }); page.wrapper.unmount();
});

test('first_definitive_rejection_allows_edit_and_a_new_intent', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const create = vi.spyOn(client.family, 'create').mockRejectedValueOnce(new AppError('INVALID_INPUT'));
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('被拒的家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  await page.wrapper.find('input').setValue('新的家'); await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(create.mock.calls[1][0].name).toBe('新的家'); expect(create.mock.calls[1][0].requestId).not.toBe(create.mock.calls[0][0].requestId);
  expect(navigation).toEqual(['/pages/family/home']); page.wrapper.unmount();
});

test('uncertain_intent_stays_locked_even_if_a_later_retry_returns_invalid_input', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  vi.spyOn(client.family, 'create').mockRejectedValueOnce(new AppError('UNAVAILABLE')).mockRejectedValueOnce(new AppError('INVALID_INPUT'));
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('原来的家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises(); await page.wrapper.find('[data-resume]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('input').attributes('disabled')).toBeDefined(); expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe('原来的家');
  expect(page.wrapper.text()).not.toContain('请修改后重试');
  expect(page.wrapper.find('[data-create]').exists()).toBe(false); expect(navigation).toEqual([]); page.wrapper.unmount();
});

test('old_create_auth_rejection_cannot_navigate_after_uid_changed_during_logout', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); await h.seedIdentity({ uid: 'bob' });
  const alice = h.client('alice'); const bob = h.client('bob'); const gate = deferCall(); let selected = alice;
  vi.spyOn(alice.family, 'create').mockRejectedValue(new AppError('AUTH_REQUIRED'));
  const client: AppClient = { recipes: selected.recipes, account: {
    session: () => selected.account.session(), signInWeixin: () => selected.account.signInWeixin(),
    async signOut() { const account = selected.account; await gate.promise; await account.signOut(); },
  }, family: { ...selected.family, current: () => selected.family.current(), create: input => selected.family.create(input) } };
  const page = mountPage(Onboarding, { client }); await page.show(); await page.wrapper.find('input').setValue('Alice家');
  await page.wrapper.find('[data-create]').trigger('click'); await flushPromises(); expect(page.auth.phase.value).toBe('signing-out');
  selected = bob; await page.auth.signIn(); gate.resolve(null); await flushPromises();
  expect(navigation).toEqual([]); expect(page.wrapper.text()).not.toContain('Alice家');
  await page.show(); expect(page.auth.identity.value?.uid).toBe('bob'); expect(page.wrapper.find('[data-family-form]').exists()).toBe(true); page.wrapper.unmount();
});
