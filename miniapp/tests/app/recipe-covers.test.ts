// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import List from '../../src/pages/recipes/index.vue';
import Detail from '../../src/pages/recipes/detail.vue';
import { mountPage } from '../support/uni-stubs';
import { mediaFixture, request } from '../support/media-fixtures';
import { deferCall } from '../support/sdk-transport';
import { AppError } from '../../src/shared/errors';

beforeEach(() => vi.stubGlobal('uni', { switchTab: vi.fn(), reLaunch: vi.fn(), navigateTo: vi.fn(), getAppBaseInfo: () => ({ hostFontSizeSetting: 20 }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function withCover() {
  const f = await mediaFixture(); const row = await f.recipe(); const image = await f.upload();
  const recipe = await f.owner.recipes.bindImages({ ...f.scope, requestId: request(), id: row.id, version: row.version, imageIds: [image.mediaId] });
  return { ...f, recipe, image };
}

test('list_displays_private_cover_without_changing_editor_media_and_reflows_large_fonts', async () => {
  const f = await withCover(); const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(page.wrapper.findAll('[data-private-image]')).toHaveLength(1);
  expect(page.wrapper.find('[data-private-image]').attributes('src')).toMatch(/^https:/);
  expect(page.controllers.media.items.value).toEqual([]);
  expect(page.wrapper.find('.recipe-grid').classes()).toContain('large-font');
  await page.hide(); expect(page.wrapper.findAll('[data-private-image]')).toHaveLength(0); page.wrapper.unmount();
});

test('covers_deduplicate_first_ids_and_batch_twenty_while_one_read_failure_keeps_other_images_and_text', async () => {
  const f = await withCover();
  vi.spyOn(f.owner.recipes, 'list').mockResolvedValue({ items: Array.from({ length: 23 }, (_, i) => ({ ...f.recipe, id: 'recipe-' + i, imageIds: ['image-' + (i % 22), 'unused-second'] })), nextCursor: null });
  const batches: string[][] = [];
  vi.spyOn(f.owner.media, 'status').mockImplementation(async input => {
    batches.push(input.mediaIds); if (input.mediaIds.length > 20) throw new AppError('INVALID_INPUT');
    return input.mediaIds.map(mediaId => ({ mediaId, state: 'ready', review: 'disabled', uploadExpiresAt: 0, retryable: false }));
  });
  vi.spyOn(f.owner.media, 'read').mockImplementation(async input => {
    if (input.mediaId === 'image-0') throw new AppError('UNAVAILABLE');
    return { mediaId: input.mediaId, url: 'https://private.example/' + input.mediaId, expiresAt: Date.now() + 60_000 };
  });
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(batches.map(batch => batch.length)).toEqual([20, 2]);
  expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(23);
  expect(page.wrapper.findAll('[data-private-image]')).toHaveLength(21);
  expect(page.wrapper.text()).toContain('图片加载失败'); page.wrapper.unmount();
});

test('hidden_filter_changed_unmounted_and_changed_family_pages_discard_late_cover_reads', async () => {
  for (const action of ['hide', 'filter', 'unmount', 'family'] as const) {
    const f = await withCover(); const gate = deferCall(); const started = deferCall(); const read = f.owner.media.read;
    vi.spyOn(f.owner.media, 'read').mockImplementation(async input => { const value = await read(input); started.resolve(null); await gate.promise; return value; });
    const page = mountPage(List, { client: f.owner }); const showing = page.show(); await flushPromises();
    expect(page.wrapper.find('[data-protected]').exists()).toBe(true); expect(f.owner.media.read).toHaveBeenCalledTimes(1); await started.promise;
    if (action === 'hide') await page.hide();
    if (action === 'filter') { await page.wrapper.find('[data-query]').setValue('nothing'); await page.wrapper.find('[data-search]').trigger('click'); await flushPromises(); }
    if (action === 'unmount') page.wrapper.unmount();
    if (action === 'family') { await f.owner.family.transferOwner({ ...f.scope, requestId: request(), uid: 'member', targetGeneration: f.joined.generation }); await page.family.load(); }
    gate.resolve(null); await showing; await flushPromises();
    expect(page.wrapper.findAll('[data-private-image]')).toHaveLength(0);
    if (action !== 'unmount') page.wrapper.unmount();
  }
});

test('detail_keeps_recipe_text_on_media_failure_and_retries_failed_links_and_image_errors', async () => {
  const f = await withCover(); vi.spyOn(f.owner.media, 'read').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Detail, { client: f.owner }); await page.load({ id: f.recipe.id }); await page.show();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
  expect(page.wrapper.text()).toContain('盐适量'); expect(page.wrapper.text()).toContain('图片加载失败');
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true);
  await page.wrapper.find('[data-private-image]').trigger('error'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(false);
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true); page.wrapper.unmount();
});

test('cover_expiration_removes_short_link_until_explicit_refresh', async () => {
  const f = await withCover(); vi.useFakeTimers();
  vi.spyOn(f.owner.media, 'read').mockImplementation(async input => ({ mediaId: input.mediaId, url: 'https://private.example/' + Date.now(), expiresAt: Date.now() + 1000 }));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true);
  await vi.advanceTimersByTimeAsync(1001); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(false); expect(page.wrapper.text()).toContain('图片链接已到期');
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true); page.wrapper.unmount();
});


test('a_later_auth_failure_is_not_swallowed_after_an_independent_image_network_failure', async () => {
  const f = await withCover();
  vi.spyOn(f.owner.recipes, 'list').mockResolvedValue({ items: [f.recipe, { ...f.recipe, id: 'second-recipe', imageIds: ['second-image'] }], nextCursor: null });
  vi.spyOn(f.owner.media, 'status').mockImplementation(async input => input.mediaIds.map(mediaId => ({ mediaId, state: 'ready', review: 'disabled', uploadExpiresAt: 0, retryable: false })));
  const gate = deferCall();
  vi.spyOn(f.owner.media, 'read').mockImplementation(async input => {
    if (input.mediaId === f.image.mediaId) throw new AppError('UNAVAILABLE');
    await gate.promise; throw new AppError('AUTH_REQUIRED');
  });
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
  gate.resolve(null); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(page.auth.phase.value).toBe('anonymous');
  expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/account/login' }); page.wrapper.unmount();
});

test('status_batch_failure_can_be_retried_without_hiding_other_batches', async () => {
  const f = await withCover();
  vi.spyOn(f.owner.recipes, 'list').mockResolvedValue({ items: Array.from({ length: 21 }, (_, index) => ({ ...f.recipe, id: 'recipe-' + index, imageIds: ['image-' + index] })), nextCursor: null });
  vi.spyOn(f.owner.media, 'status').mockRejectedValueOnce(new AppError('UNAVAILABLE')).mockImplementation(async input => input.mediaIds.map(mediaId => ({ mediaId, state: 'ready', review: 'disabled', uploadExpiresAt: 0, retryable: false })));
  vi.spyOn(f.owner.media, 'read').mockImplementation(async input => ({ mediaId: input.mediaId, url: 'https://private.example/' + input.mediaId, expiresAt: Date.now() + 1000 }));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(21); expect(page.wrapper.findAll('[data-private-image]')).toHaveLength(1);
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.findAll('[data-private-image]')).toHaveLength(2); page.wrapper.unmount();
});

test.each([List, Detail])('status_auth_failure_clears_protected_recipe_content_%#', async component => {
  const f = await withCover(); vi.spyOn(f.owner.media, 'status').mockRejectedValueOnce(new AppError('AUTH_REQUIRED'));
  const page = mountPage(component, { client: f.owner }); await page.load({ id: f.recipe.id }); await page.show(); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(page.auth.phase.value).toBe('anonymous'); page.wrapper.unmount();
});

test('detail_status_failure_keeps_text_and_expiration_and_image_errors_clear_links', async () => {
  const f = await withCover(); vi.spyOn(f.owner.media, 'status').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  vi.spyOn(f.owner.media, 'read').mockImplementation(async input => ({ mediaId: input.mediaId, url: 'https://private.example/' + Date.now(), expiresAt: Date.now() + 1000 }));
  vi.useFakeTimers(); const page = mountPage(Detail, { client: f.owner }); await page.load({ id: f.recipe.id }); await page.show();
  expect(page.wrapper.text()).toContain('盐适量'); expect(page.wrapper.text()).toContain('图片加载失败');
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true);
  await vi.advanceTimersByTimeAsync(1001); await flushPromises();
  expect(page.controllers.media.links.value).toEqual({}); expect(page.wrapper.text()).toContain('图片链接已到期');
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true); page.wrapper.unmount();
});

test('review_states_and_empty_favorites_are_distinct_from_missing_images_and_matches', async () => {
  const f = await withCover();
  const states = ['pending', 'rejected', 'review-error'] as const;
  vi.spyOn(f.owner.recipes, 'list').mockResolvedValueOnce({ items: states.map((state, index) => ({ ...f.recipe, id: 'recipe-' + index, imageIds: [state] })), nextCursor: null });
  vi.spyOn(f.owner.media, 'status').mockResolvedValue(states.map(state => ({ mediaId: state, state, review: 'disabled', uploadExpiresAt: 0, retryable: false })));
  const read = vi.spyOn(f.owner.media, 'read'); const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(page.wrapper.text()).toContain('图片审核中'); expect(page.wrapper.text()).toContain('图片审核未通过'); expect(page.wrapper.text()).toContain('图片审核异常'); expect(read).not.toHaveBeenCalled();
  await page.wrapper.find('[data-favorites]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('还没有收藏的菜谱');
  await page.wrapper.find('[data-query]').setValue('missing'); await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('没有符合条件的菜谱'); page.wrapper.unmount();
});

test('cover_permission_failure_hides_content_and_offers_explicit_page_revalidation', async () => {
  const f = await withCover(); vi.spyOn(f.owner.media, 'read').mockRejectedValueOnce(new AppError('FORBIDDEN'));
  const page = mountPage(List, { client: f.owner }); await page.show(); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  expect(page.wrapper.find('[data-retry]').exists()).toBe(true);
  await page.wrapper.find('[data-retry]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-private-image]').exists()).toBe(true); page.wrapper.unmount();
});

test('add_panel_offers_only_manual_and_text_import_and_closes_on_hide', async () => {
  const f = await mediaFixture(); const page = mountPage(List, { client: f.owner }); await page.show();
  await page.wrapper.find('[data-create]').trigger('click');
  expect(page.wrapper.findAll('[data-action]').map(button => button.text())).toEqual(['手动创建菜谱', 'AI 文本导入']);
  await page.wrapper.find('[data-action="1"]').trigger('click');
  expect(uni.navigateTo).toHaveBeenCalledWith({ url: '/pages/imports/submit' });
  await page.wrapper.find('[data-create]').trigger('click'); await page.hide(); await page.show();
  expect(page.wrapper.find('[role="dialog"]').exists()).toBe(false); page.wrapper.unmount();
});

test('fresh_moderation_state_replaces_an_old_link_failure_placeholder', async () => {
  const f = await withCover(); vi.spyOn(f.owner.media, 'read').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Detail, { client: f.owner }); await page.load({ id: f.recipe.id }); await page.show();
  expect(page.wrapper.text()).toContain('图片加载失败');
  vi.spyOn(f.owner.media, 'status').mockResolvedValue([{ ...f.image, state: 'rejected' }]);
  await page.wrapper.find('[data-retry-cover]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('图片审核未通过'); expect(page.wrapper.text()).not.toContain('图片加载失败');
  page.wrapper.unmount();
});
