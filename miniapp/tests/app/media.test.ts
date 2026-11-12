// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import Edit from '../../src/pages/recipes/edit.vue';
import Detail from '../../src/pages/recipes/detail.vue';
import { mountPage } from '../support/uni-stubs';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { mediaFixture, png, request } from '../support/media-fixtures';
import { AppError } from '../../src/shared/errors';
import { receiveReview } from '../../uniCloud-alipay/cloudfunctions/common/home-media';

const preview = vi.fn(); let choose: () => Promise<unknown>;
const selection = { tempFilePaths: ['temp/image.png'], tempFiles: [{ path: 'temp/image.png', size: png.length }] };
beforeEach(() => {
  preview.mockClear(); choose = async () => selection;
  vi.stubGlobal('uni', { switchTab: vi.fn(), reLaunch: vi.fn(), redirectTo: vi.fn(), navigateTo: vi.fn(), showModal: async () => ({ confirm: true }),
    chooseImage: () => choose(), previewImage: preview, getFileSystemManager: () => ({ readFile: (options: { success(value: { data: string }): void }) => options.success({ data: png.toString('base64') }) }) });
});
afterEach(() => vi.unstubAllGlobals());
test('image_save_is_independent_and_preserves_unsaved_text_and_version', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const storage = createMemoryStorage();
  const page = mountPage(Edit, { client: f.owner, storage }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('input[data-title]').setValue('尚未保存的文字');
  await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises();
  expect(page.wrapper.findAll('[data-image]')).toHaveLength(1); expect(page.wrapper.text()).toContain('可保存');
  await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises();
  expect(await f.owner.recipes.get(recipe.id)).toMatchObject({ title: '图片菜谱', version: 2, imageIds: [expect.any(String)] });
  expect((page.wrapper.find('input[data-title]').element as HTMLInputElement).value).toBe('尚未保存的文字');
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect(await f.owner.recipes.get(recipe.id)).toMatchObject({ title: '尚未保存的文字', version: 3, imageIds: [expect.any(String)] });
  expect(JSON.stringify(storage.get('home.media.pending.v1:owner') ?? null)).not.toContain('https://'); page.wrapper.unmount();
  const detail = mountPage(Detail, { client: f.member }); await detail.load({ id: recipe.id }); await detail.show();
  expect(detail.wrapper.find('[data-recipe-image]').exists()).toBe(true);
  await detail.wrapper.find('[data-recipe-image]').trigger('tap'); await flushPromises(); expect(preview).toHaveBeenCalledOnce(); detail.wrapper.unmount();
});
test('new_recipe_explains_text_first_and_chooser_cancel_does_not_allocate', async () => {
  const f = await mediaFixture(); const page = mountPage(Edit, { client: f.owner }); await page.load({}); await page.show();
  expect(page.wrapper.text()).toContain('请先保存菜谱文字'); expect(page.wrapper.find('[data-choose-image]').exists()).toBe(false); page.wrapper.unmount();
  const recipe = await f.recipe(); const edit = mountPage(Edit, { client: f.owner }); await edit.load({ id: recipe.id }); await edit.show();
  choose = async () => { throw { errMsg: 'chooseImage:fail cancel' }; };
  await edit.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises(); expect(await f.h.rows('media_files')).toHaveLength(0); edit.wrapper.unmount();
});

test.each(['before-show', 'during-check', 'after-check'])('native_picker_resumes_after_foreground_validation_%s', async timing => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const picked = deferCall(); const entered = deferCall(); const session = deferCall();
  const requestUpload = vi.spyOn(f.owner.media, 'requestUpload');
  const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('input[data-title]').setValue('选图前的文字草稿');
  choose = async () => { entered.resolve(null); return picked.promise; };
  await page.wrapper.find('[data-choose-image]').trigger('click'); await entered.promise; await page.hide();
  if (timing === 'during-check') {
    const original = f.owner.account.session;
    vi.spyOn(f.owner.account, 'session').mockImplementation(async () => { await session.promise; return original(); });
  }
  let returning = timing === 'before-show' ? undefined : page.show();
  if (timing === 'after-check') await returning;
  picked.resolve(selection); await flushPromises();
  if (timing !== 'after-check') expect(requestUpload).not.toHaveBeenCalled();
  if (timing === 'before-show') returning = page.show();
  if (timing === 'during-check') session.resolve(null);
  await returning; await flushPromises();
  expect(requestUpload).toHaveBeenCalledOnce(); expect(page.controllers.media.items.value[0]?.state).toBe('ready');
  expect((page.wrapper.find('input[data-title]').element as HTMLInputElement).value).toBe('选图前的文字草稿');
  await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises();
  expect((await f.owner.recipes.get(recipe.id)).imageIds).toHaveLength(1); page.wrapper.unmount();
});

test('native_picker_does_not_upload_after_failed_validation_signout_or_unload', async () => {
  for (const outcome of ['unavailable', 'signout', 'unload']) {
    const f = await mediaFixture(); const recipe = await f.recipe(); const picked = deferCall(); const entered = deferCall();
    const requestUpload = vi.spyOn(f.owner.media, 'requestUpload');
    const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
    choose = async () => { entered.resolve(null); return picked.promise; };
    await page.wrapper.find('[data-choose-image]').trigger('click'); await entered.promise; await page.hide();
    picked.resolve(selection); await flushPromises();
    if (outcome === 'unload') await page.unload();
    else if (outcome === 'signout') {
      vi.spyOn(f.owner.account, 'signOut').mockResolvedValue();
      await page.auth.signOut(); await page.auth.signIn(); await page.load({ id: recipe.id }); await page.show();
    } else { vi.spyOn(f.owner.account, 'session').mockRejectedValue(new AppError('UNAVAILABLE')); await page.show(); }
    await flushPromises(); expect(requestUpload).not.toHaveBeenCalled(); expect(page.controllers.media.items.value).toEqual([]); page.wrapper.unmount();
  }
});

test('native_picker_does_not_resume_across_membership_generations', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const picked = deferCall(); const entered = deferCall();
  const requestUpload = vi.spyOn(f.member.media, 'requestUpload');
  const page = mountPage(Edit, { client: f.member }); await page.load({ id: recipe.id }); await page.show();
  choose = async () => { entered.resolve(null); return picked.promise; };
  await page.wrapper.find('[data-choose-image]').trigger('click'); await entered.promise; await page.hide();
  await f.member.family.leave({ ...f.memberScope, requestId: request() });
  const invite = await f.owner.family.invite({ requestId: request() }); await f.member.family.join({ requestId: request(), token: invite.token });
  picked.resolve(selection); await flushPromises(); await page.show(); await flushPromises();
  expect(requestUpload).not.toHaveBeenCalled(); expect(page.controllers.media.items.value).toEqual([]); page.wrapper.unmount();
});
test('mock_review_waits_refreshes_and_allows_save_only_after_callback', async () => {
  const f = await mediaFixture({ review: { mode: 'mock', async submit() { return 'page-trace'; } } }); const recipe = await f.recipe();
  const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('等待审核'); expect(page.wrapper.text()).toContain('模拟审核'); expect(page.wrapper.find('[data-save-images]').attributes('aria-disabled')).toBe('true');
  await receiveReview({ database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive }, 'page-trace', 'pass');
  await page.wrapper.find('[data-refresh-images]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-save-images]').attributes('disabled')).toBeUndefined(); page.wrapper.unmount();
});
test('lost_image_save_reply_resumes_original_request_after_restart', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const storage = createMemoryStorage(); const bind = f.owner.recipes.bindImages;
  const sent: unknown[] = []; let lost = true;
  vi.spyOn(f.owner.recipes, 'bindImages').mockImplementation(async input => { sent.push(structuredClone(input)); const result = await bind(input); if (lost) { lost = false; throw new AppError('UNAVAILABLE'); } return result; });
  const page = mountPage(Edit, { client: f.owner, storage }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises();
  await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises(); expect(page.wrapper.text()).toContain('恢复原图片保存请求');
  const saved = JSON.stringify(storage.get('home.media.pending.v1:owner')); expect(saved).not.toContain(png.toString('base64')); expect(saved).not.toContain('https://'); page.wrapper.unmount();
  const restored = mountPage(Edit, { client: f.owner, storage }); await restored.load({ id: recipe.id }); await restored.show();
  await restored.wrapper.find('[data-save-images]').trigger('click'); await flushPromises(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect((await f.owner.recipes.get(recipe.id)).version).toBe(2); restored.wrapper.unmount();
});
test('hidden_picker_or_upload_response_cannot_restore_images', async () => {
  for (const stage of ['picker', 'upload']) {
    const f = await mediaFixture(); const recipe = await f.recipe(); const wait = deferCall(); const entered = deferCall();
    if (stage === 'picker') choose = async () => { entered.resolve(null); await wait.promise; return { tempFilePaths: ['temp/image.png'], tempFiles: [{ path: 'temp/image.png', size: png.length }] }; };
    else { const upload = f.owner.media.upload; vi.spyOn(f.owner.media, 'upload').mockImplementation(async input => { entered.resolve(null); await wait.promise; return upload(input); }); }
    const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
    await page.wrapper.find('[data-choose-image]').trigger('click'); await entered.promise; await page.hide(); wait.resolve(null); await flushPromises();
    expect(page.controllers.media.items.value).toEqual([]); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
  }
});
test('version_conflict_preserves_text_and_can_reload_then_remove_images', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('input[data-title]').setValue('本地文字'); await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises();
  await f.owner.recipes.bindImages({ ...f.scope, requestId: request(), id: recipe.id, version: 1, imageIds: [] });
  await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises();
  expect((page.wrapper.find('input[data-title]').element as HTMLInputElement).value).toBe('本地文字'); expect((await f.owner.recipes.get(recipe.id)).imageIds).toEqual([]);
  await page.wrapper.find('[data-reload]').trigger('click'); await flushPromises();
  await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises(); expect((await f.owner.recipes.get(recipe.id)).imageIds).toHaveLength(1);
  await page.wrapper.find('[data-remove-image]').trigger('click'); await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises(); expect((await f.owner.recipes.get(recipe.id)).imageIds).toEqual([]); page.wrapper.unmount();
});
test('signout_clears_links_and_persisted_media_intent', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const storage = createMemoryStorage(); const page = mountPage(Edit, { client: f.owner, storage }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises(); expect(page.controllers.media.items.value).toHaveLength(1);
  await page.auth.signOut(); expect(page.controllers.media.items.value).toEqual([]); expect(page.controllers.media.links.value).toEqual({}); expect(storage.get('home.media.pending.v1:owner')).toBeUndefined(); page.wrapper.unmount();
});
test('opening_another_recipe_does_not_overwrite_an_unknown_image_save', async () => {
  const f = await mediaFixture(); const first = await f.recipe(); const second = await f.recipe(); const storage = createMemoryStorage();
  const bind = f.owner.recipes.bindImages; let lost = true; const sent: unknown[] = [];
  vi.spyOn(f.owner.recipes, 'bindImages').mockImplementation(async input => { sent.push(structuredClone(input)); const result = await bind(input); if (input.id === first.id && lost) { lost = false; throw new AppError('UNAVAILABLE'); } return result; });
  const a = mountPage(Edit, { client: f.owner, storage }); await a.load({ id: first.id }); await a.show();
  await a.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises(); await a.wrapper.find('[data-save-images]').trigger('click'); await flushPromises(); a.wrapper.unmount();
  const b = mountPage(Edit, { client: f.owner, storage }); await b.load({ id: second.id }); await b.show();
  await b.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises(); await b.wrapper.find('[data-save-images]').trigger('click'); await flushPromises(); b.wrapper.unmount();
  const resumed = mountPage(Edit, { client: f.owner, storage }); await resumed.load({ id: first.id }); await resumed.show();
  expect(resumed.wrapper.text()).toContain('恢复原图片保存请求'); await resumed.wrapper.find('[data-save-images]').trigger('click'); await flushPromises();
  expect(sent[2]).toEqual(sent[0]); resumed.wrapper.unmount();
});
test('old_membership_draft_is_discarded_after_leave_and_rejoin', async () => {
  const f = await mediaFixture(); const recipe = await f.recipe(); const storage = createMemoryStorage();
  const page = mountPage(Edit, { client: f.member, storage }); await page.load({ id: recipe.id }); await page.show();
  await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises(); expect(page.controllers.media.items.value).toHaveLength(1); page.wrapper.unmount();
  await f.member.family.leave({ ...f.memberScope, requestId: request() }); const invite = await f.owner.family.invite({ requestId: request() }); await f.member.family.join({ requestId: request(), token: invite.token });
  const rejoined = mountPage(Edit, { client: f.member, storage }); await rejoined.load({ id: recipe.id }); await rejoined.show();
  expect(rejoined.controllers.media.items.value).toEqual([]); expect(storage.get('home.media.pending.v1:member')).toBeUndefined(); rejoined.wrapper.unmount();
});
