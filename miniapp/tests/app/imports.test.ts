// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createHarness } from '../support/harness';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { mountPage } from '../support/uni-stubs';
import Submit from '../../src/pages/imports/submit.vue';
import Status from '../../src/pages/imports/status.vue';
import List from '../../src/pages/recipes/index.vue';
import { AppError } from '../../src/shared/errors';

const navigation: string[] = [];
beforeEach(() => { navigation.length = 0; vi.stubGlobal('uni', { switchTab: ({ url }: { url: string }) => navigation.push(url), reLaunch: ({ url }: { url: string }) => navigation.push(url), redirectTo: ({ url }: { url: string }) => navigation.push(url), navigateTo: ({ url }: { url: string }) => navigation.push(url) }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ requestId: 'imports-page-family-01', name: '家' }); return { h, client, storage: createMemoryStorage() };
}
test('lost_submission_replays_same_request_after_cold_start_then_retains_only_job_id', async () => {
  const f = await setup(); let lost = true; const submit = f.client.imports.submit.bind(f.client.imports); const sent: unknown[] = [];
  vi.spyOn(f.client.imports, 'submit').mockImplementation(async input => { sent.push(structuredClone(input)); const job = await submit(input); if (lost) { lost = false; throw new AppError('UNAVAILABLE'); } return job; });
  const first = mountPage(Submit, f); await first.show(); await first.wrapper.find('[data-text]').setValue('盐汤：盐适量，加水煮开。');
  await first.wrapper.find('[data-submit]').trigger('click'); await flushPromises(); expect(first.wrapper.find('[data-replay]').exists()).toBe(true); first.wrapper.unmount();
  const second = mountPage(Submit, f); await second.show(); expect(second.wrapper.find('[data-replay]').exists()).toBe(true);
  await second.wrapper.find('[data-replay]').trigger('click'); await flushPromises(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  expect(await f.h.rows('import_jobs')).toHaveLength(1); expect(JSON.stringify(second.controllers.imports.restore())).not.toContain('盐汤');
  expect(navigation.at(-1)).toMatch(/^\/pages\/imports\/status\?id=[a-f0-9]{32}$/); second.wrapper.unmount();
});
test('closing_page_does_not_stop_worker_and_recent_entry_restores_saved_result_and_edit_links', async () => {
  const f = await setup(); const submit = mountPage(Submit, f); await submit.show(); await submit.wrapper.find('[data-text]').setValue('盐汤：盐适量，加水煮开。');
  await submit.wrapper.find('[data-submit]').trigger('click'); await flushPromises(); submit.wrapper.unmount(); await f.h.runImports();
  const list = mountPage(List, f); await list.show(); expect(list.wrapper.find('[data-import-resume]').exists()).toBe(true); list.wrapper.unmount();
  const status = mountPage(Status, f); await status.load({}); await status.show(); expect(status.wrapper.text()).toContain('已保存');
  const [saved] = await f.h.rows<{ _id: string }>('recipes'); await status.wrapper.find('[data-open]').trigger('click'); expect(navigation.at(-1)).toBe('/pages/recipes/detail?id=' + saved._id);
  await status.wrapper.find('[data-edit]').trigger('click'); expect(navigation.at(-1)).toBe('/pages/recipes/edit?id=' + saved._id); status.wrapper.unmount();
});
test('polls_serially_stops_on_hide_and_terminal_and_revalidates_on_show', async () => {
  const f = await setup(); const home = (await f.client.family.current())!;
  const job = await f.client.imports.submit({ requestId: 'imports-page-submit-01', familyId: home.familyId, generation: home.generation, source: { kind: 'text', text: '盐汤' } });
  vi.useFakeTimers(); const actual = f.client.imports.get.bind(f.client.imports); const get = vi.spyOn(f.client.imports, 'get'); const page = mountPage(Status, f); await page.load({ id: job.id }); await page.show();
  await vi.advanceTimersByTimeAsync(3000); await flushPromises(); expect(get).toHaveBeenCalledTimes(2);
  const pending = deferCall(); get.mockImplementationOnce(async () => { await pending.promise; return actual(job.id); });
  await vi.advanceTimersByTimeAsync(3000); await vi.advanceTimersByTimeAsync(12000); expect(get).toHaveBeenCalledTimes(3);
  await page.hide(); pending.resolve(null); await flushPromises(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  await vi.advanceTimersByTimeAsync(6000); expect(get).toHaveBeenCalledTimes(3);
  await f.h.runImports(); await page.show(); const calls = get.mock.calls.length; await vi.advanceTimersByTimeAsync(9000); expect(get).toHaveBeenCalledTimes(calls); expect(page.wrapper.text()).toContain('已保存'); page.wrapper.unmount();
});
test('logout_reentry_restores_id_but_account_switch_and_old_generation_never_show_old_job', async () => {
  const f = await setup(); const submit = mountPage(Submit, f); await submit.show(); await submit.wrapper.find('[data-text]').setValue('盐汤'); await submit.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
  vi.spyOn(f.client.account, 'signOut').mockResolvedValue(); await submit.auth.signOut(); await submit.auth.signIn(); await submit.family.load();
  expect(submit.controllers.imports.restore()).toMatchObject({ kind: 'job' }); submit.wrapper.unmount();
  await f.h.seedIdentity({ uid: 'bob' }); const other = f.h.client('bob'); await other.family.create({ requestId: 'imports-page-family-02', name: '另一家' });
  const bob = mountPage(List, { client: other, storage: f.storage }); await bob.show(); expect(bob.wrapper.find('[data-import-resume]').exists()).toBe(false); bob.wrapper.unmount();
  await f.h.database.transaction(async tx => { const member = await tx.get<Record<string, unknown>>('family_members', 'alice'); await tx.replace('family_members', 'alice', { ...member, _id: 'alice', generation: 'new-generation' }); });
  const old = mountPage(List, f); await old.show(); expect(old.wrapper.find('[data-import-resume]').exists()).toBe(false); old.wrapper.unmount();
});

test('hidden_submission_acknowledgment_discards_raw_text_without_navigating_or_showing_result', async () => {
  const f = await setup(); const gate = deferCall(); const actual = f.client.imports.submit.bind(f.client.imports);
  vi.spyOn(f.client.imports, 'submit').mockImplementation(async input => { const job = await actual(input); await gate.promise; return job; });
  const page = mountPage(Submit, f); await page.show(); await page.wrapper.find('[data-text]').setValue('盐汤原文'); await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises(); await page.hide();
  gate.resolve(null); await flushPromises(); expect(navigation).toEqual([]); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  expect(page.controllers.imports.restore()).toMatchObject({ kind: 'job' }); expect(page.controllers.imports.job.value).toBeNull(); page.wrapper.unmount();
});
test('logout_after_lost_submit_retains_scoped_original_request_for_reentry', async () => {
  const f = await setup(); const submit = f.client.imports.submit.bind(f.client.imports); const requests: string[] = []; let lost = true;
  vi.spyOn(f.client.imports, 'submit').mockImplementation(async input => { requests.push(input.requestId); const job = await submit(input); if (lost) { lost = false; throw new AppError('UNAVAILABLE'); } return job; });
  vi.spyOn(f.client.account, 'signOut').mockResolvedValue();
  const page = mountPage(Submit, f); await page.show(); await page.wrapper.find('[data-text]').setValue('盐汤'); await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
  await page.auth.signOut(); await page.auth.signIn(); await page.show();
  expect(page.wrapper.find('[data-replay]').exists()).toBe(true); await page.wrapper.find('[data-replay]').trigger('click'); await flushPromises();
  expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]); expect(await f.h.rows('import_jobs')).toHaveLength(1); page.wrapper.unmount();
});
test('opening_an_older_status_cannot_overwrite_an_unacknowledged_new_submission', async () => {
  const f = await setup(); const home = (await f.client.family.current())!;
  const old = await f.client.imports.submit({ requestId: 'imports-older-status-01', familyId: home.familyId, generation: home.generation, source: { kind: 'text', text: '旧菜谱' } });
  const actual = f.client.imports.submit.bind(f.client.imports); vi.spyOn(f.client.imports, 'submit').mockImplementation(async input => { await actual(input); throw new AppError('UNAVAILABLE'); });
  const submit = mountPage(Submit, f); await submit.show(); await submit.wrapper.find('[data-text]').setValue('新菜谱'); await submit.wrapper.find('[data-submit]').trigger('click'); await flushPromises(); submit.wrapper.unmount();
  const status = mountPage(Status, f); await status.load({ id: old.id }); await status.show();
  expect(status.controllers.imports.restore()).toMatchObject({ kind: 'pending', input: { source: { text: '新菜谱' } } }); status.wrapper.unmount();
});
