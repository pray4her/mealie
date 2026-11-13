// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import Submit from '../../src/pages/imports/submit.vue';
import { mountPage } from '../support/uni-stubs';
import { mediaFixture, png, request } from '../support/media-fixtures';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { defaultConfig } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/model';
import { receiveReview } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import { AppError } from '../../src/shared/errors';

const selection = { tempFilePaths: ['temp/source.png'], tempFiles: [{ path: 'temp/source.png', size: png.length }] };
let choose: () => Promise<unknown>; let sequence = 0;
beforeEach(() => {
  choose = async () => selection;
  vi.stubGlobal('wx', { getRandomValues: ({ success }: { success(result: { randomValues: ArrayBuffer }): void }) => { const bytes = new Uint8Array(16); bytes[0] = ++sequence; success({ randomValues: bytes.buffer }); } });
  vi.stubGlobal('uni', { switchTab: vi.fn(), reLaunch: vi.fn(), redirectTo: vi.fn(), navigateTo: vi.fn(), showModal: async () => ({ confirm: true }),
    chooseImage: () => choose(), previewImage: vi.fn(), getFileSystemManager: () => ({ readFile: ({ success }: { success(result: { data: string }): void }) => success({ data: png.toString('base64') }) }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() { return mediaFixture({ importsConfig: () => ({ ...defaultConfig(), enabled: true, imageEnabled: true }), review: { mode: 'mock', async submit(row) { return 'page-image-' + row._id; } } }); }
async function pick(page: ReturnType<typeof mountPage>) { await page.wrapper.find('[data-method-image]').trigger('click'); await page.wrapper.find('[data-choose-import-image]').trigger('click'); await flushPromises(); }
async function approve(f: Awaited<ReturnType<typeof setup>>, page: ReturnType<typeof mountPage>) {
  const [row] = await f.h.rows<{ _id: string }>('media_files');
  await receiveReview({ database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive }, 'page-image-' + row._id, 'pass');
  await page.wrapper.find('[data-refresh-import-image]').trigger('click'); await flushPromises();
}
test('image_tab_waits_for_review_then_submits_only_business_reference_and_clears_local_preview', async () => {
  const f = await setup(); const page = mountPage(Submit, { client: f.owner }); await page.show(); await pick(page);
  expect(page.wrapper.text()).toContain('等待审核'); expect(page.wrapper.find('[data-submit]').attributes('aria-disabled')).toBe('true');
  await approve(f, page); await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
  expect(await f.h.rows('import_jobs')).toMatchObject([{ sourceKind: 'image', sourceMediaId: expect.any(String), sourceText: null }]);
  expect(uni.redirectTo).toHaveBeenCalled(); expect(page.wrapper.find('[data-import-preview]').exists()).toBe(false); page.wrapper.unmount();
});
test('lost_image_submit_restores_same_request_after_unmount_without_base64_or_temp_path', async () => {
  const f = await setup(); const storage = createMemoryStorage(); const sent: unknown[] = []; let lost = true; const original = f.owner.imports.submit;
  vi.spyOn(f.owner.imports, 'submit').mockImplementation(async input => { sent.push(structuredClone(input)); const result = await original(input); if (lost) { lost = false; throw new AppError('UNAVAILABLE'); } return result; });
  const page = mountPage(Submit, { client: f.owner, storage }); await page.show(); await pick(page); await approve(f, page);
  await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
  expect(JSON.stringify(page.controllers.imports.restore())).not.toMatch(/base64|temp\/|https:/); page.wrapper.unmount();
  const next = mountPage(Submit, { client: f.owner, storage }); await next.show(); await next.wrapper.find('[data-replay]').trigger('click'); await flushPromises();
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(await f.h.rows('import_jobs')).toHaveLength(1); next.wrapper.unmount();
});
test('native_picker_revalidates_same_scope_and_never_uploads_after_membership_generation_change', async () => {
  const f = await setup(); const gate = deferCall(); choose = () => gate.promise;
  const page = mountPage(Submit, { client: f.member }); await page.show();
  await page.wrapper.find('[data-method-image]').trigger('click'); await page.wrapper.find('[data-choose-import-image]').trigger('click'); await page.hide();
  await f.member.family.leave({ ...f.memberScope, requestId: request() }); const invitation = await f.owner.family.invite({ requestId: request() });
  await f.member.family.join({ requestId: request(), token: invitation.token }); gate.resolve(selection); await flushPromises(); await page.show();
  expect(await f.h.rows('media_files')).toEqual([]); page.wrapper.unmount();
});
test('native_picker_resumes_same_scope_and_cancel_is_not_an_error', async () => {
  const f = await setup(); const gate = deferCall(); choose = () => gate.promise;
  const page = mountPage(Submit, { client: f.owner }); await page.show();
  await page.wrapper.find('[data-method-image]').trigger('click'); await page.wrapper.find('[data-choose-import-image]').trigger('click'); await page.hide();
  gate.resolve(selection); await flushPromises(); await page.show(); await flushPromises(); expect(await f.h.rows('media_files')).toHaveLength(1);
  choose = async () => { throw { errMsg: 'chooseImage:fail cancel' }; };
  await page.wrapper.find('[data-choose-import-image]').trigger('click'); await flushPromises(); expect(page.wrapper.text()).not.toContain('图片选择失败'); page.wrapper.unmount();
});
test('definitive_missing_image_submit_drops_pending_intent_and_allows_reselection', async () => {
  const f = await setup(); const page = mountPage(Submit, { client: f.owner }); await page.show(); await pick(page); await approve(f, page);
  vi.spyOn(f.owner.imports, 'submit').mockRejectedValueOnce(new AppError('NOT_FOUND'));
  await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
  expect(page.controllers.imports.restore()).toBeNull(); expect(page.wrapper.find('[data-replay]').exists()).toBe(false); expect(page.wrapper.text()).toContain('重新选择'); page.wrapper.unmount();
});
