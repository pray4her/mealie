// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import WdPopup from '@wot-ui/ui/components/wd-popup/wd-popup.vue';
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import HomeAction from '../../src/components/HomeAction.vue';
import Edit from '../../src/pages/recipes/edit.vue';
import Submit from '../../src/pages/imports/submit.vue';
import Join from '../../src/pages/family/join.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import Login from '../../src/pages/account/login.vue';
import List from '../../src/pages/recipes/index.vue';
import { AppError } from '../../src/shared/errors';
import { invitationDigest } from '../../src/features/family/token-digest';
import { createHarness } from '../support/harness';
import { mountPage } from '../support/uni-stubs';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { mediaFixture, request } from '../support/media-fixtures';

const navigation: string[] = [];
const modal = vi.fn(async (options: { confirmText?: string }) => {
  if ([...(options.confirmText ?? '确定')].length > 4) throw new Error('showModal:fail confirmText exceeds 4 characters');
  return { confirm: true, cancel: false };
});
beforeEach(() => {
  navigation.length = 0; modal.mockReset();
  const navigate = ({ url }: { url: string }) => navigation.push(url);
  vi.stubGlobal('uni', { showModal: modal, switchTab: navigate, navigateTo: navigate, reLaunch: navigate, redirectTo: navigate });
});
afterEach(() => vi.unstubAllGlobals());
async function noFamily() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  return { h, client: h.client('alice'), storage: createMemoryStorage() };
}

test('native_four_character_limit_allows_dirty_abandon_and_reload', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe();
  const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
  try {
    await page.wrapper.find('[data-title]').setValue('未保存');
    const get = vi.spyOn(f.owner.recipes, 'get');
    await page.wrapper.find('[data-reload]').trigger('click'); await flushPromises();
    expect(get).toHaveBeenCalledWith(recipe.id); expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe(recipe.title);
    await page.wrapper.find('[data-title]').setValue('未保存');
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises();
    expect(navigation.at(-1)).toBe('/pages/recipes/index'); expect(modal).toHaveBeenCalledTimes(2);
    expect(modal.mock.calls.map(([options]) => options.confirmText)).toEqual(['重新加载', '放弃离开']);
  } finally { page.wrapper.unmount(); }
});

test('cold_join_accepts_manual_original_code_and_replays_only_its_digest_bound_request', async () => {
  const f = await noFamily(); await f.h.seedIdentity({ uid: 'owner' }); const owner = f.h.client('owner');
  await owner.family.create({ requestId: request(), name: '家' });
  const originalCode = await owner.family.invite({ requestId: request() }); const otherCode = await owner.family.invite({ requestId: request() });
  const actual = f.client.family.join.bind(f.client.family); const calls: string[] = [];
  const join = vi.spyOn(f.client.family, 'join').mockImplementation(async input => { calls.push(input.requestId); if (calls.length === 1) throw new AppError('UNAVAILABLE'); return actual(input); });
  const first = mountPage(Join, f); await first.load({ token: originalCode.token }); await first.show();
  await first.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises(); await first.hide(); first.wrapper.unmount();
  const saved = f.storage.get('home.family.join.v1:alice'); expect(JSON.stringify(saved)).not.toContain(originalCode.token);
  const cold = mountPage(Join, f); await cold.show();
  try {
    expect(cold.wrapper.findComponent(WdForm).props('disabled')).toBe(false);
    expect(cold.wrapper.find('input').attributes('disabled')).toBeUndefined();
    await cold.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
    expect(cold.wrapper.find('#invitation-code-error').exists()).toBe(true); expect(join).toHaveBeenCalledTimes(1);
    await cold.wrapper.find('input').setValue(otherCode.token); await cold.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
    expect(join).toHaveBeenCalledTimes(1); expect(f.storage.get('home.family.join.v1:alice')).toEqual(saved);
    expect(cold.wrapper.find('input').exists()).toBe(true);
    await cold.wrapper.find('input').setValue(originalCode.token); await cold.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
    expect(calls).toEqual([calls[0], calls[0]]); expect(f.storage.get('home.family.join.v1:alice')).toBeUndefined();
    expect(navigation.at(-1)).toBe('/pages/recipes/index');
  } finally { cold.wrapper.unmount(); }
});

test.each(['back', 'sign-out'])('cold_pending_join_confirms_discarding_manually_reentered_code_%s', async action => {
  const f = await noFamily(); await f.h.seedIdentity({ uid: 'owner' }); const owner = f.h.client('owner');
  await owner.family.create({ requestId: request(), name: '家' }); const invitation = await owner.family.invite({ requestId: request() });
  const saved = { requestId: request(), tokenHash: invitationDigest(invitation.token) }; f.storage.set('home.family.join.v1:alice', saved);
  const join = vi.spyOn(f.client.family, 'join'); const signOut = vi.spyOn(f.client.account, 'signOut').mockResolvedValue();
  const page = mountPage(Join, f); await page.show();
  const selector = action === 'back' ? '[data-back-onboarding]' : '[data-sign-out]';
  try {
    await page.wrapper.find('input').setValue(invitation.token); modal.mockResolvedValueOnce({ confirm: false, cancel: true });
    await page.wrapper.find(selector).trigger('click'); await flushPromises();
    expect(modal).toHaveBeenCalledTimes(1); expect(navigation).toEqual([]); expect(signOut).not.toHaveBeenCalled();
    expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe(invitation.token);
    expect(f.storage.get('home.family.join.v1:alice')).toEqual(saved); expect(JSON.stringify(saved)).not.toContain(invitation.token); expect(join).not.toHaveBeenCalled();
    await page.wrapper.find(selector).trigger('click'); await flushPromises(); expect(modal).toHaveBeenCalledTimes(2);
    expect(navigation.at(-1)).toBe(action === 'back' ? '/pages/family/onboarding' : '/pages/account/login');
  } finally { page.wrapper.unmount(); }
});

test.each(['pending', 'failed'])('join_leave_confirmation_cannot_sign_out_a_new_owner_while_family_read_is_%s', async state => {
  const f = await noFamily(); await f.h.seedIdentity({ uid: 'bob' }); const bob = f.h.client('bob');
  const page = mountPage(Join, f); await page.show(); const confirmation = deferCall(); const familyRead = deferCall();
  const signOut = vi.spyOn(f.client.account, 'signOut').mockResolvedValue(); let loading: Promise<unknown> | undefined;
  modal.mockImplementationOnce(async () => { await confirmation.promise; return { confirm: true, cancel: false }; });
  try {
    await page.wrapper.find('input').setValue('保留的邀请码'); await page.wrapper.find('[data-sign-out]').trigger('click'); await flushPromises(); expect(modal).toHaveBeenCalledTimes(1);
    page.family.clear();
    vi.spyOn(f.client.account, 'session').mockImplementationOnce(() => bob.account.session());
    vi.spyOn(f.client.family, 'current').mockImplementationOnce(async () => { await familyRead.promise; throw new AppError('UNAVAILABLE'); });
    loading = page.family.load().catch(() => {}); await flushPromises(); expect(page.auth.identity.value?.uid).toBe('bob');
    if (state === 'failed') { familyRead.resolve(null); await loading; }
    confirmation.resolve(null); await flushPromises();
    expect(signOut).not.toHaveBeenCalled(); expect(page.auth.identity.value?.uid).toBe('bob'); expect(navigation).toEqual([]);
  } finally { confirmation.resolve(null); familyRead.resolve(null); await loading; page.wrapper.unmount(); }
});

test('background_import_acknowledgment_clears_only_the_text_of_this_pages_submitted_request', async () => {
  const f = await mediaFixture(); const gate = deferCall(); const actual = f.owner.imports.submit.bind(f.owner.imports);
  const submit = vi.spyOn(f.owner.imports, 'submit').mockImplementation(async input => { const job = await actual(input); await gate.promise; return job; });
  const page = mountPage(Submit, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find('[data-text]').setValue('已经提交的盐汤'); await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
    await page.hide(); gate.resolve(null); await flushPromises(); expect(navigation).toEqual([]);
    await page.show(); expect((page.wrapper.find('[data-text]').element as HTMLTextAreaElement).value).toBe('');
    await page.wrapper.find('[data-acknowledged-job]').trigger('click'); await flushPromises(); expect(navigation.at(-1)).toMatch(/^\/pages\/imports\/status\?id=/);
    await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises(); expect(submit).toHaveBeenCalledTimes(1);
    expect(await f.h.rows('import_jobs')).toHaveLength(1);
  } finally { page.wrapper.unmount(); }
});

test('late_import_acknowledgment_after_reshow_cannot_turn_a_replay_click_into_a_new_paid_request', async () => {
  const f = await mediaFixture(); const gate = deferCall(); const actual = f.owner.imports.submit.bind(f.owner.imports);
  const submit = vi.spyOn(f.owner.imports, 'submit').mockImplementation(async input => { const job = await actual(input); await gate.promise; return job; });
  const page = mountPage(Submit, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find('[data-text]').setValue('迟到确认的盐汤'); await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
    const originalRequest = submit.mock.calls[0][0].requestId;
    await page.hide(); await page.show(); const replay = page.wrapper.findAllComponents(HomeAction).find(action => action.props('label') === '恢复原请求')!; expect(replay.exists()).toBe(true);
    gate.resolve(null); await flushPromises(); replay.vm.$emit('click'); await flushPromises();
    expect(submit.mock.calls.map(([input]) => input.requestId)).toEqual([originalRequest]); expect(await f.h.rows('import_jobs')).toHaveLength(1);
    expect((page.wrapper.find('[data-text]').element as HTMLTextAreaElement).value).toBe(''); expect(page.wrapper.find('[data-replay]').exists()).toBe(false);
    await page.wrapper.find('[data-acknowledged-job]').trigger('click'); await flushPromises(); expect(navigation.at(-1)).toMatch(/^\/pages\/imports\/status\?id=/);
  } finally { gate.resolve(null); page.wrapper.unmount(); }
});

test('an_unrelated_historical_import_job_does_not_erase_a_new_unsent_draft', async () => {
  const f = await mediaFixture(); const storage = createMemoryStorage();
  const page = mountPage(Submit, { client: f.owner, storage }); await page.show();
  try {
    await page.wrapper.find('[data-text]').setValue('尚未发送的新菜谱'); await page.hide();
    const job = await f.owner.imports.submit({ ...f.scope, requestId: request(), source: { kind: 'text', text: '历史菜谱' } });
    storage.set('home.imports.latest.v1:' + ['owner', f.home.familyId, f.home.generation].map(encodeURIComponent).join(':'), { kind: 'job', id: job.id });
    await page.show(); expect((page.wrapper.find('[data-text]').element as HTMLTextAreaElement).value).toBe('尚未发送的新菜谱');
  } finally { page.wrapper.unmount(); }
});

test.each([Edit, Submit])('retained_draft_can_leave_after_return_time_family_read_failure_%#', async component => {
  const f = await mediaFixture(); const page = mountPage(component, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find(component === Edit ? '[data-title]' : '[data-text]').setValue('保留的草稿');
    await page.hide(); vi.spyOn(f.owner.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE')); await page.show();
    expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises();
    expect(modal).toHaveBeenCalledTimes(1); expect(navigation.at(-1)).toBe('/pages/recipes/index');
  } finally { page.wrapper.unmount(); }
});

test('import_can_return_when_the_initial_family_check_fails_before_any_draft_is_initialized', async () => {
  const f = await mediaFixture(); vi.spyOn(f.owner.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Submit, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises();
    expect(modal).not.toHaveBeenCalled(); expect(navigation.at(-1)).toBe('/pages/recipes/index');
  } finally { page.wrapper.unmount(); }
});

test.each([Join, Onboarding])('retained_family_form_can_sign_out_after_return_time_identity_failure_%#', async component => {
  const f = await noFamily(); const page = mountPage(component, f); await page.show();
  try {
    await page.wrapper.find('input').setValue('保留的草稿'); await page.hide();
    vi.spyOn(f.client.account, 'session').mockRejectedValueOnce(new AppError('UNAVAILABLE')); await page.show();
    expect(page.auth.phase.value).toBe('unavailable');
    await page.wrapper.find('[data-sign-out]').trigger('click'); await flushPromises();
    expect(modal).toHaveBeenCalledTimes(1); expect(page.auth.phase.value).toBe('anonymous');
    expect(navigation.at(-1)).toBe('/pages/account/login');
  } finally { page.wrapper.unmount(); }
});

test('a_leave_confirmation_from_before_hide_cannot_navigate_after_reshow', async () => {
  const f = await mediaFixture(); const page = mountPage(Submit, { client: f.owner }); await page.show(); const gate = deferCall();
  modal.mockImplementationOnce(async () => { await gate.promise; return { confirm: true, cancel: false }; });
  try {
    await page.wrapper.find('[data-text]').setValue('草稿'); await page.wrapper.find('[data-back]').trigger('click'); await flushPromises();
    await page.hide(); await page.show(); gate.resolve(null); await flushPromises(); expect(navigation).toEqual([]);
  } finally { page.wrapper.unmount(); }
});

test('unloading_a_hidden_dirty_page_does_not_disable_the_new_pages_native_alert', async () => {
  const enable = vi.fn(); const disable = vi.fn(); Object.assign(uni, { enableAlertBeforeUnload: enable, disableAlertBeforeUnload: disable });
  const f = await mediaFixture(); const old = mountPage(Submit, { client: f.owner }); await old.show();
  await old.wrapper.find('[data-text]').setValue('旧页草稿'); await old.hide();
  const current = mountPage(Edit, { client: f.owner }); await current.show();
  try {
    enable.mockClear(); disable.mockClear(); await current.wrapper.find('[data-title]').setValue('新页草稿'); expect(enable).toHaveBeenCalled();
    await old.unload(); old.wrapper.unmount(); expect(disable).not.toHaveBeenCalled();
  } finally { current.wrapper.unmount(); }
});

test.each(['cancel', 'overlay'])('abandoned_tag_is_not_committed_by_search_favorites_or_clear_%s', async close => {
  const f = await mediaFixture(); await f.recipe(); const page = mountPage(List, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find('[data-filter]').trigger('click'); await flushPromises();
    await vi.waitFor(() => expect(page.wrapper.find('input[data-tag]').exists()).toBe(true));
    await page.wrapper.find('input[data-tag]').setValue('未应用的标签');
    if (close === 'cancel') await page.wrapper.find('[aria-label="取消"]').trigger('click');
    else page.wrapper.findAllComponents(WdPopup)[0].vm.$emit('update:modelValue', false);
    await page.wrapper.find('[data-favorites]').trigger('click'); await flushPromises(); expect(page.controllers.recipes.filters.value.tag).toBe('');
    await page.wrapper.find('[data-query] input').setValue('图片'); await page.wrapper.find('[data-query] input').trigger('confirm'); await flushPromises();
    expect(page.controllers.recipes.filters.value.tag).toBe('');
    await page.wrapper.find('[data-clear-query]').trigger('click'); await flushPromises(); expect(page.controllers.recipes.filters.value.tag).toBe('');
  } finally { page.wrapper.unmount(); }
});

test('authenticated_login_family_resolution_is_busy_singleflight_and_retries_without_oauth', async () => {
  const f = await mediaFixture(); const gate = deferCall(); const actual = f.owner.family.current.bind(f.owner.family);
  const current = vi.spyOn(f.owner.family, 'current').mockImplementationOnce(async () => { await gate.promise; throw new AppError('UNAVAILABLE'); });
  const signIn = vi.spyOn(f.owner.account, 'signInWeixin'); const page = mountPage(Login, { client: f.owner });
  try {
    const showing = page.show(); await flushPromises(); expect(page.auth.phase.value).toBe('authenticated');
    expect(page.wrapper.find('[data-sign-in]').attributes('aria-disabled')).toBe('true');
    await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises(); expect(signIn).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledTimes(1);
    gate.resolve(null); await showing; expect(page.wrapper.find('[data-sign-in]').text()).toBe('重新读取家庭');
    const retryGate = deferCall(); current.mockImplementationOnce(async () => { await retryGate.promise; return actual(); });
    await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises(); await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
    expect(current).toHaveBeenCalledTimes(2); expect(signIn).not.toHaveBeenCalled();
    retryGate.resolve(null); await flushPromises(); expect(navigation.at(-1)).toBe('/pages/recipes/index');
  } finally { page.wrapper.unmount(); }
});

test('a_hidden_family_retry_failure_does_not_replace_the_current_login_shows_state', async () => {
  const f = await mediaFixture(); const gate = deferCall(); const actual = f.owner.family.current.bind(f.owner.family);
  const current = vi.spyOn(f.owner.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Login, { client: f.owner }); await page.show();
  try {
    current.mockImplementationOnce(async () => { await gate.promise; throw new AppError('UNAVAILABLE'); });
    await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises(); await page.hide();
    current.mockImplementationOnce(actual); await page.show(); const before = [...navigation];
    gate.resolve(null); await flushPromises(); expect(navigation).toEqual(before);
    expect(page.wrapper.find('.error').exists()).toBe(false); expect(page.wrapper.find('[data-sign-in]').attributes('aria-disabled')).toBe('false');
  } finally { page.wrapper.unmount(); }
});

test.each(['ingredients', 'steps'] as const)('populated_%s_removal_confirms_and_resolves_the_original_stable_row', async kind => {
  const f = await mediaFixture(); const page = mountPage(Edit, { client: f.owner }); await page.show();
  const add = kind === 'ingredients' ? '[data-add-ingredient]' : '[data-add-step]';
  const remove = kind === 'ingredients' ? '[data-remove-ingredient]' : '[data-remove-step]';
  const field = kind === 'ingredients' ? '[data-raw]' : '[data-step]';
  try {
    await page.wrapper.find(add).trigger('click'); await page.wrapper.findAll(field)[1].setValue('不能误删的内容');
    modal.mockResolvedValueOnce({ confirm: false, cancel: true });
    await page.wrapper.findAll(remove)[1].trigger('click'); await flushPromises(); expect(page.wrapper.findAll(field)).toHaveLength(2);
    const gate = deferCall(); modal.mockImplementationOnce(async () => { await gate.promise; return { confirm: true, cancel: false }; });
    await page.wrapper.findAll(remove)[1].trigger('click'); await flushPromises();
    await page.wrapper.findAll(remove)[0].trigger('click'); await page.wrapper.find(add).trigger('click');
    expect(page.wrapper.findAll(field)).toHaveLength(2); gate.resolve(null); await flushPromises();
    expect(page.wrapper.findAll(field)).toHaveLength(1); expect((page.wrapper.find(field).element as HTMLInputElement).value).toBe('');
  } finally { page.wrapper.unmount(); }
});

test('row_removal_confirmation_is_rejected_after_a_family_generation_change', async () => {
  const f = await mediaFixture(); const page = mountPage(Edit, { client: f.owner }); await page.show(); const gate = deferCall();
  try {
    await page.wrapper.find('[data-add-step]').trigger('click'); await page.wrapper.findAll('[data-step]')[1].setValue('保留步骤');
    modal.mockImplementationOnce(async () => { await gate.promise; return { confirm: true, cancel: false }; });
    await page.wrapper.findAll('[data-remove-step]')[1].trigger('click'); await flushPromises();
    await f.h.database.transaction(async tx => {
      const member = await tx.get<Record<string, unknown>>('family_members', 'owner');
      await tx.replace('family_members', 'owner', { ...member, _id: 'owner', generation: 'new-generation' });
    });
    await page.family.load(); await page.show(); await page.wrapper.find('[data-add-step]').trigger('click');
    await page.wrapper.findAll('[data-step]')[1].setValue('新范围的步骤'); gate.resolve(null); await flushPromises();
    expect(page.wrapper.findAll('[data-step]')).toHaveLength(2); expect((page.wrapper.findAll('[data-step]')[1].element as HTMLTextAreaElement).value).toBe('新范围的步骤');
  } finally { page.wrapper.unmount(); }
});
