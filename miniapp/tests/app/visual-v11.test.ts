// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import List from '../../src/pages/recipes/index.vue';
import Status from '../../src/pages/imports/status.vue';
import Invite from '../../src/pages/family/invite.vue';
import Login from '../../src/pages/account/login.vue';
import { createProductionClient } from '../../review/app-client';
import { AppError } from '../../src/shared/errors';
import { mountPage } from '../support/uni-stubs';
import { mediaFixture } from '../support/media-fixtures';

beforeEach(() => { vi.stubGlobal('uni', { navigateTo: vi.fn(), switchTab: vi.fn() }); });
afterEach(() => { vi.unstubAllGlobals(); });

test('devtools_factor_point_four_cannot_shrink_standard_text', async () => {
  Object.assign(uni, { getAppBaseInfo: () => ({ fontSizeSetting: 16, fontSizeScaleFactor: .4 }), getDeviceInfo: () => ({ platform: 'devtools' }) });
  const f = await mediaFixture(); const page = mountPage(List, { client: f.owner });
  try { await page.show(); expect(page.wrapper.find('page-meta').attributes('root-font-size')).toBe('16px'); }
  finally { page.wrapper.unmount(); }
});

test('exact_tag_is_applied_in_sheet_and_favorite_does_not_open_recipe', async () => {
  const f = await mediaFixture(); await f.recipe(); const page = mountPage(List, { client: f.owner });
  try {
    await page.show(); expect(page.wrapper.find('input[data-tag]').exists()).toBe(false);
    await page.wrapper.find('[data-filter]').trigger('click'); await flushPromises();
    await vi.waitFor(() => expect(page.wrapper.find('input[data-tag]').exists()).toBe(true));
    await page.wrapper.find('input[data-tag]').setValue('不存在');
    await page.wrapper.find('[data-apply-filter]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0);
    await page.wrapper.find('[data-clear-tag]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(1);
    await page.wrapper.find('[data-favorite]').trigger('click'); await flushPromises();
    expect(uni.navigateTo).not.toHaveBeenCalled();
    expect(page.wrapper.find('[data-favorite]').attributes('aria-pressed')).toBe('true');
    expect(page.wrapper.find('[data-all]').text()).not.toContain('已选');
  } finally { page.wrapper.unmount(); }
});

test('cancel_import_requires_confirmation_and_cancel_keeps_job_running', async () => {
  Object.assign(uni, { getStorageSync: () => ({}), showModal: vi.fn().mockResolvedValue({ confirm: false }) });
  const client = createProductionClient(); const cancel = vi.spyOn(client.imports, 'cancel'); const page = mountPage(Status, { client });
  try {
    await page.load({ id: 'f'.repeat(32) }); await page.show();
    await page.wrapper.find('[data-cancel]').trigger('click'); await flushPromises(); expect(cancel).not.toHaveBeenCalled();
    vi.mocked(uni.showModal).mockResolvedValueOnce({ confirm: true, cancel: false, errMsg: 'showModal:ok' });
    await page.wrapper.find('[data-cancel]').trigger('click'); await flushPromises(); expect(cancel).toHaveBeenCalledTimes(1);
    expect(page.wrapper.text()).toContain('已取消');
  } finally { page.wrapper.unmount(); }
});

test('revoking_invitation_cancel_keeps_original_invitation_available', async () => {
  Object.assign(uni, { showModal: vi.fn().mockResolvedValue({ confirm: false }) });
  const f = await mediaFixture(); const revoke = vi.spyOn(f.owner.family, 'revokeInvite'); const page = mountPage(Invite, { client: f.owner });
  try { await page.show(); await page.wrapper.find('[data-generate]').trigger('click'); await flushPromises(); await page.wrapper.find('[data-revoke]').trigger('click'); await flushPromises(); expect(revoke).not.toHaveBeenCalled(); }
  finally { page.wrapper.unmount(); }
});

test('family_retry_after_login_does_not_start_another_weixin_signin', async () => {
  const f = await mediaFixture(); vi.spyOn(f.owner.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const signIn = vi.spyOn(f.owner.account, 'signInWeixin'); const page = mountPage(Login, { client: f.owner });
  try {
    await page.show(); expect(page.wrapper.find('[data-sign-in]').text()).toBe('重新读取家庭');
    await page.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
    expect(signIn).not.toHaveBeenCalled(); expect(uni.switchTab).toHaveBeenCalledWith({ url: '/pages/recipes/index' });
  } finally { page.wrapper.unmount(); }
});
