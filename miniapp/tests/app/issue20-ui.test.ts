// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import List from '../../src/pages/recipes/index.vue';
import { mountPage } from '../support/uni-stubs';
import { mediaFixture, request } from '../support/media-fixtures';
import Login from '../../src/pages/account/login.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import Home from '../../src/pages/family/home.vue';
import Join from '../../src/pages/family/join.vue';
import Submit from '../../src/pages/imports/submit.vue';
import Status from '../../src/pages/imports/status.vue';
import Detail from '../../src/pages/recipes/detail.vue';
import { AppError } from '../../src/shared/errors';
import { deferCall, createMemoryStorage } from '../support/sdk-transport';
import { createAccountApi } from '../../src/features/auth/api';
import { createMediaApi } from '../../src/features/media/api';
import { createSessionBoundary } from '../../src/shared/session-boundary';

beforeEach(() => { vi.stubGlobal('uni', { navigateTo: vi.fn(), reLaunch: vi.fn(), switchTab: vi.fn() }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('real_search_confirm_submits_and_add_sheet_exposes_only_delivered_routes', async () => {
  const f = await mediaFixture(); await f.recipe();
  const page = mountPage(List, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find('[data-query] input').setValue('不存在');
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(1);
    await page.wrapper.find('[data-query] input').trigger('confirm'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0);
    await page.wrapper.find('[data-add]').trigger('click'); await flushPromises();
    await vi.waitFor(() => expect(page.wrapper.find('[data-create]').exists()).toBe(true));
    await page.wrapper.find('[data-create]').trigger('click');
    expect(uni.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/recipes/edit' });
    await page.wrapper.find('[data-add]').trigger('click'); await flushPromises();
    await vi.waitFor(() => expect(page.wrapper.find('[data-import]').exists()).toBe(true));
    await page.wrapper.find('[data-import]').trigger('click');
    expect(uni.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/imports/submit' });
    await page.hide(); expect(page.wrapper.find('[data-create]').exists()).toBe(false);
  } finally { page.wrapper.unmount(); }
});

test('existing_login_creation_and_join_enter_recipe_tab_while_expiry_resets_stack', async () => {
  const f = await mediaFixture();
  for (const component of [Login, Onboarding]) {
    const page = mountPage(component, { client: f.owner }); await page.show();
    expect(uni.switchTab).toHaveBeenLastCalledWith({ url: '/pages/recipes/index' }); page.wrapper.unmount();
  }
  const h = f.h; await h.seedIdentity({ uid: 'new' }); const client = h.client('new');
  const create = mountPage(Onboarding, { client }); await create.show();
  await create.wrapper.find('input').setValue('新家庭'); await create.wrapper.find('[data-create]').trigger('click'); await flushPromises();
  expect(uni.switchTab).toHaveBeenLastCalledWith({ url: '/pages/recipes/index' }); create.wrapper.unmount();
  await h.seedIdentity({ uid: 'joiner' }); const invite = await f.owner.family.invite({ requestId: 'issue20-invitation-01' });
  const join = mountPage(Join, { client: h.client('joiner') }); await join.load({ token: invite.token }); await join.show();
  await join.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
  expect(uni.switchTab).toHaveBeenLastCalledWith({ url: '/pages/recipes/index' }); join.wrapper.unmount();
  const home = mountPage(Home, { client: f.owner }); await home.show(); await home.wrapper.find('[data-recipes]').trigger('click');
  expect(uni.switchTab).toHaveBeenLastCalledWith({ url: '/pages/recipes/index' });
  await home.hide(); h.revokeToken('owner'); await home.show();
  expect(uni.reLaunch).toHaveBeenLastCalledWith({ url: '/pages/account/login' }); home.wrapper.unmount();
});

test.each([Submit, Status])('import_return_uses_recipe_tab_%#', async component => {
  const f = await mediaFixture(); const page = mountPage(component, { client: f.owner }); await page.load({}); await page.show();
  try {
    await page.wrapper.findAll('button').at(-1)!.trigger('click');
    expect(uni.switchTab).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/pages/recipes/index' }));
  } finally { page.wrapper.unmount(); }
});

async function imageRecipe() {
  const f = await mediaFixture(); const image = await f.upload(); const recipe = await f.recipe();
  await f.owner.recipes.bindImages({ ...f.scope, requestId: 'issue20-bind-image-01', id: recipe.id, version: recipe.version, imageIds: [image.mediaId] });
  return { ...f, image, recipe };
}

test('cover_read_failure_keeps_recipe_and_can_retry_without_persisting_links', async () => {
  const f = await imageRecipe(); const storage = createMemoryStorage();
  const read = vi.spyOn(f.owner.media, 'read').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(List, { client: f.owner, storage }); await page.show(); await flushPromises();
  try {
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(1);
    expect(page.wrapper.text()).toContain('图片加载失败');
    await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
    expect(page.wrapper.find('[data-cover]').attributes('src')).toMatch(/^https:/);
    expect(read).toHaveBeenCalledTimes(2);
    expect(storage.get('home.media.pending.v1:owner')).toBeUndefined();
    await page.hide(); expect(page.wrapper.find('[data-cover]').exists()).toBe(false);
  } finally { page.wrapper.unmount(); }
});

test('cover_expiry_refreshes_at_actual_deadline_and_stops_when_hidden', async () => {
  const f = await imageRecipe(); vi.useFakeTimers();
  const read = vi.spyOn(f.owner.media, 'read').mockImplementation(async input => ({ mediaId: input.mediaId, url: 'https://private.test/' + Date.now(), expiresAt: Date.now() + 1500 }));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  try {
    expect(page.wrapper.find('[data-cover]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1500); await flushPromises(); expect(read).toHaveBeenCalledTimes(2);
    await page.hide(); await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(2);
  } finally { page.wrapper.unmount(); }
});

test('old_filter_cover_reply_cannot_reappear_in_new_results', async () => {
  const f = await imageRecipe(); const gate = deferCall(); const read = f.owner.media.read.bind(f.owner.media);
  vi.spyOn(f.owner.media, 'read').mockImplementationOnce(async input => { await gate.promise; return read(input); });
  const page = mountPage(List, { client: f.owner }); await page.show();
  try {
    await page.wrapper.find('[data-query] input').setValue('不存在'); await page.wrapper.find('[data-query] input').trigger('confirm'); await flushPromises();
    gate.resolve(null); await flushPromises(); expect(page.wrapper.find('[data-cover]').exists()).toBe(false);
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0);
  } finally { page.wrapper.unmount(); }
});

test.each(['account', 'generation'] as const)('late_cover_cannot_cross_scope_%s', async kind => {
  const f = await imageRecipe(); const gate = deferCall(); const read = f.owner.media.read.bind(f.owner.media);
  vi.spyOn(f.owner.media, 'read').mockImplementationOnce(async input => { const link = await read(input); await gate.promise; return link; });
  const page = mountPage(List, { client: f.owner }); await page.show();
  try {
    if (kind === 'account') { vi.spyOn(f.owner.account, 'signOut').mockResolvedValue(); await page.auth.signOut(); }
    else { const current = await f.owner.family.current(); vi.spyOn(f.owner.family, 'current').mockResolvedValue({ ...current!, generation: 'new-generation' }); await page.family.load(); }
    gate.resolve(null); await flushPromises(); expect(page.wrapper.find('[data-cover]').exists()).toBe(false);
  } finally { page.wrapper.unmount(); }
});

test('detail_media_failure_does_not_hide_authorized_body_and_retry_recovers', async () => {
  const f = await imageRecipe(); vi.spyOn(f.owner.media, 'status').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Detail, { client: f.owner }); await page.load({ id: f.recipe.id }); await page.show();
  try {
    expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
    expect(page.wrapper.text()).toContain('盐适量'); expect(page.wrapper.text()).toContain('图片加载失败');
    expect(page.wrapper.findAll('.photo')).toHaveLength(1);
    expect(page.wrapper.find('.photo').text()).toBe('图片加载失败');
    await page.wrapper.find('[data-retry-images]').trigger('click'); await flushPromises();
    expect(page.wrapper.find('[data-recipe-image]').exists()).toBe(true);
  } finally { page.wrapper.unmount(); }
});

test('detail_single_image_error_keeps_other_images_visible_and_retry_restores_gallery', async () => {
  const f = await imageRecipe(); const second = await f.upload();
  const recipe = await f.owner.recipes.get(f.recipe.id);
  await f.owner.recipes.bindImages({ ...f.scope, requestId: request(), id: recipe.id, version: recipe.version, imageIds: [f.image.mediaId, second.mediaId] });
  const page = mountPage(Detail, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
  try {
    const images = page.wrapper.findAll('[data-recipe-image]'); expect(images).toHaveLength(2);
    const secondUrl = images[1].attributes('src');
    await images[0].trigger('error'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe-image]')).toHaveLength(1);
    expect(page.wrapper.find('[data-recipe-image]').attributes('src')).toBe(secondUrl);
    expect(page.wrapper.findAll('.photo')).toHaveLength(2);
    expect(page.wrapper.find('.photo').text()).toContain('图片加载失败');
    await page.wrapper.find('[data-retry-images]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe-image]')).toHaveLength(2);
    expect(page.wrapper.findAll('.photo')).toHaveLength(2);
    expect(page.wrapper.find('[data-retry-images]').exists()).toBe(false);
  } finally { page.wrapper.unmount(); }
});

test('detail_image_frames_stay_visible_while_retry_is_loading', async () => {
  const f = await imageRecipe(); const gate = deferCall(); const status = f.owner.media.status.bind(f.owner.media);
  const page = mountPage(Detail, { client: f.owner }); await page.load({ id: f.recipe.id }); await page.show();
  try {
    await page.wrapper.find('[data-recipe-image]').trigger('error'); await flushPromises();
    vi.spyOn(f.owner.media, 'status').mockImplementationOnce(async input => { await gate.promise; return status(input); });
    await page.wrapper.find('[data-retry-images]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('.photo')).toHaveLength(1);
    expect(page.wrapper.find('.photo').text()).toContain('图片加载中');
    gate.resolve(null); await flushPromises();
    expect(page.wrapper.find('[data-recipe-image]').exists()).toBe(true);
  } finally { gate.resolve(null); await flushPromises(); page.wrapper.unmount(); }
});

test('cover_batches_stay_bounded_and_unreadable_states_do_not_request_links', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe();
  vi.spyOn(f.owner.recipes, 'list').mockResolvedValue({ items: Array.from({ length: 25 }, (_, index) => ({ ...recipe, id: 'recipe-' + index, imageIds: ['media-' + index] })), nextCursor: null });
  const status = vi.spyOn(f.owner.media, 'status').mockImplementation(async input => input.mediaIds.map((mediaId, index) => ({ mediaId, state: index === 0 ? 'pending' : 'ready', uploadExpiresAt: 0, review: 'weixin', retryable: false })));
  const read = vi.spyOn(f.owner.media, 'read').mockImplementation(async input => ({ mediaId: input.mediaId, url: 'https://private.test/' + input.mediaId, expiresAt: Date.now() + 60_000 }));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  try {
    expect(status.mock.calls.map(([input]) => input.mediaIds.length)).toEqual([20, 5]);
    expect(read).toHaveBeenCalledTimes(23); expect(page.wrapper.findAll('[data-cover]')).toHaveLength(23);
    expect(page.wrapper.text()).toContain('图片审核中');
  } finally { page.wrapper.unmount(); }
});

test('cover_authentication_failure_hides_content_and_uses_existing_guard', async () => {
  const f = await imageRecipe(); vi.spyOn(f.owner.media, 'status').mockRejectedValueOnce(new AppError('AUTH_REQUIRED'));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  try {
    expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
    expect(uni.reLaunch).toHaveBeenLastCalledWith({ url: '/pages/account/login' });
  } finally { page.wrapper.unmount(); }
});

test('cover_permission_failure_offers_recheck_instead_of_endless_loading', async () => {
  const f = await imageRecipe(); vi.spyOn(f.owner.media, 'status').mockRejectedValueOnce(new AppError('FORBIDDEN'));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  try {
    expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
    expect(page.wrapper.find('[data-retry]').exists()).toBe(true);
    await page.wrapper.find('[data-retry]').trigger('click'); await flushPromises();
    expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
  } finally { page.wrapper.unmount(); }
});

test.each([false, true])('real_media_boundary_expiry_only_redirects_visible_page_hidden_%s', async hidden => {
  const f = await imageRecipe(); const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); const gate = deferCall();
  const account = createAccountApi({ boundary, platformLogin: async () => 'fixture-code', wire: {
    async loginByWeixin() {}, async session() { return { uid: 'owner' }; }, async logout() {},
  } });
  const media = createMediaApi({ boundary, invoke: async () => { await gate.promise; throw new AppError('AUTH_REQUIRED'); } });
  const page = mountPage(List, { client: { ...f.owner, account, media }, storage }); await page.show();
  try {
    expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
    if (hidden) await page.hide();
    gate.resolve(null); await flushPromises();
    expect(page.auth.phase.value).toBe('anonymous'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
    if (hidden) expect(uni.reLaunch).not.toHaveBeenCalled();
    else expect(uni.reLaunch).toHaveBeenCalledExactlyOnceWith({ url: '/pages/account/login' });
  } finally { page.wrapper.unmount(); }
});

test.each([{ width: 320, font: 16, single: false }, { width: 390, font: 22, single: true }])('standard_narrow_keeps_photo_grid_and_large_text_reflows_%j', async ({ width, font, single }) => {
  Object.assign(uni, { getWindowInfo: () => ({ windowWidth: width }), getAppBaseInfo: () => ({ fontSizeSetting: font }) });
  const f = await mediaFixture(); const page = mountPage(List, { client: f.owner }); await page.show();
  try { expect(page.wrapper.find('.recipe-grid').classes().includes('single-column')).toBe(single); }
  finally { page.wrapper.unmount(); }
});

test('favorite_action_does_not_open_recipe_and_unknown_times_are_not_a_false_total', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const page = mountPage(List, { client: f.owner }); await page.show();
  await page.wrapper.find('[data-favorite]').trigger('click'); await flushPromises();
  expect(uni.navigateTo).not.toHaveBeenCalled(); page.wrapper.unmount();
  const detail = mountPage(Detail, { client: f.owner }); await detail.load({ id: recipe.id }); await detail.show();
  try { expect(detail.wrapper.text()).not.toContain('总时长'); expect(detail.wrapper.text()).toContain('盐适量'); }
  finally { detail.wrapper.unmount(); }
});
