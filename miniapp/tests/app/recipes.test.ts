// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from 'vue';
import { flushPromises } from '@vue/test-utils';
import Edit from '../../src/pages/recipes/edit.vue';
import List from '../../src/pages/recipes/index.vue';
import Detail from '../../src/pages/recipes/detail.vue';
import { createHarness } from '../support/harness';
import { mountPage } from '../support/uni-stubs';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { provideAppClient } from '../../src/shared/app-client';
import { AppError } from '../../src/shared/errors';

const navigation: string[] = [];
let accept = true;
beforeEach(() => { accept = true; navigation.length = 0; vi.stubGlobal('uni', {
  reLaunch: ({ url }: { url: string }) => navigation.push(url), navigateTo: ({ url }: { url: string }) => navigation.push(url),
  redirectTo: ({ url }: { url: string }) => navigation.push(url),
  showModal: async () => ({ confirm: accept, cancel: !accept }),
}); });
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ requestId: 'page-family-create-01', name: '家' });
  return { h, client };
}
async function fill(page: ReturnType<typeof mountPage>) {
  await page.wrapper.find('[data-title]').setValue('家常汤');
  await page.wrapper.find('[data-raw]').setValue('盐适量');
  await page.wrapper.find('[data-name]').setValue('盐');
  await page.wrapper.find('[data-step]').setValue('放盐煮熟。');
}
test('single_page_creates_unknown_quantity_and_lists_reads_edits_saved_text', async () => {
  const { h, client } = await setup(); const page = mountPage(Edit, { client });
  await page.load({}); await page.show(); await fill(page);
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  const rows = await h.rows<{ _id: string; ingredients: { quantity: null }[] }>('recipes'); expect(rows).toHaveLength(1); expect(rows[0].ingredients[0].quantity).toBeNull();
  expect(navigation.at(-1)).toBe('/pages/recipes/detail?id=' + rows[0]._id); page.wrapper.unmount();
  const list = mountPage(List, { client }); await list.show(); expect(list.wrapper.text()).toContain('家常汤'); list.wrapper.unmount();
  const detail = mountPage(Detail, { client }); await detail.load({ id: rows[0]._id }); await detail.show();
  expect(detail.wrapper.text()).toContain('盐适量'); expect(detail.wrapper.text()).toContain('放盐煮熟。'); detail.wrapper.unmount();
  const edit = mountPage(Edit, { client }); await edit.load({ id: rows[0]._id }); await edit.show();
  await edit.wrapper.find('[data-title]').setValue('第二版');
  await edit.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect(await client.recipes.get(rows[0]._id)).toMatchObject({ title: '第二版', version: 2 }); edit.wrapper.unmount();
});
test('ingredient_and_step_rows_can_be_added_removed_and_optional_values_roundtrip', async () => {
  const { h, client } = await setup(); const page = mountPage(Edit, { client }); await page.load({}); await page.show(); await fill(page);
  await page.wrapper.find('[data-add-ingredient]').trigger('click'); expect(page.wrapper.findAll('[data-ingredient]')).toHaveLength(2);
  await page.wrapper.findAll('[data-remove-ingredient]')[1].trigger('click'); expect(page.wrapper.findAll('[data-ingredient]')).toHaveLength(1);
  await page.wrapper.find('[data-add-step]').trigger('click'); expect(page.wrapper.findAll('[data-step]')).toHaveLength(2);
  await page.wrapper.findAll('[data-remove-step]')[1].trigger('click');
  await page.wrapper.find('[data-servings]').setValue('2.5'); await page.wrapper.find('[data-prep]').setValue('0');
  await page.wrapper.find('[data-cook]').setValue('30'); await page.wrapper.find('[data-tags]').setValue('家常，汤');
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect((await h.rows('recipes'))[0]).toMatchObject({ baseServings: 2.5, prepMinutes: 0, cookMinutes: 30, tags: ['家常', '汤'] }); page.wrapper.unmount();
});
test('empty_or_zero_quantity_is_rejected_without_sending_and_input_is_retained', async () => {
  const { client } = await setup(); const send = vi.spyOn(client.recipes, 'create');
  const page = mountPage(Edit, { client }); await page.load({}); await page.show(); await fill(page);
  await page.wrapper.find('[data-quantity]').setValue('0'); await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect(send).not.toHaveBeenCalled(); expect(page.wrapper.text()).toContain('数量'); expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('家常汤'); page.wrapper.unmount();
});
test('double_tap_and_lost_reply_retry_the_original_durable_request_after_cold_start', async () => {
  const { h, client } = await setup(); const storage = createMemoryStorage(); const create = client.recipes.create.bind(client.recipes);
  const sent: unknown[] = []; let lost = true;
  vi.spyOn(client.recipes, 'create').mockImplementation(async input => { sent.push(structuredClone(input)); const result = await create(input); if (lost) { lost = false; throw new AppError('UNAVAILABLE'); } return result; });
  const page = mountPage(Edit, { client, storage }); await page.load({}); await page.show(); await fill(page);
  await Promise.all([page.wrapper.find('[data-save]').trigger('click'), page.wrapper.find('[data-save]').trigger('click')]); await flushPromises();
  expect(sent).toHaveLength(1); expect(page.wrapper.find('[data-resume]').exists()).toBe(true); page.wrapper.unmount();
  const restored = mountPage(Edit, { client, storage }); await restored.load({}); await restored.show();
  expect(restored.wrapper.find('[data-resume]').exists()).toBe(true);
  await restored.wrapper.find('[data-resume]').trigger('click'); await flushPromises();
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(await h.rows('recipes')).toHaveLength(1); restored.wrapper.unmount();
});
test('conflict_keeps_local_input_until_confirmed_reload', async () => {
  const { client } = await setup(); const view = (await client.family.current())!;
  const recipe = await client.recipes.create({ requestId: 'page-recipe-create-01', familyId: view.familyId, generation: view.generation,
    recipe: { title: '第一版', description: null, baseServings: null, prepMinutes: null, cookMinutes: null, ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] } });
  const page = mountPage(Edit, { client }); await page.load({ id: recipe.id }); await page.show(); await page.wrapper.find('[data-title]').setValue('本地未保存');
  const { title: _title, description, baseServings, prepMinutes, cookMinutes, ingredients, steps, tags } = recipe;
  await client.recipes.update({ requestId: 'page-recipe-update-02', familyId: view.familyId, generation: view.generation, id: recipe.id, version: 1, recipe: { title: '他人的修改', description, baseServings, prepMinutes, cookMinutes, ingredients, steps, tags } });
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('其他成员'); expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('本地未保存');
  accept = false; await page.wrapper.find('[data-reload]').trigger('click'); await flushPromises();
  expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('本地未保存');
  accept = true; await page.wrapper.find('[data-reload]').trigger('click'); await flushPromises();
  expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('他人的修改'); page.wrapper.unmount();
});
test('hidden_late_save_cannot_navigate_and_logout_clears_durable_recipe_content', async () => {
  const { client } = await setup(); const storage = createMemoryStorage(); const pending = deferCall();
  const actual = client.recipes.create.bind(client.recipes); vi.spyOn(client.recipes, 'create').mockImplementation(async input => { await pending.promise; return actual(input); });
  const controllers = provideAppClient(createApp({}), client, { storage, newRequestId: async () => 'page-pending-recipe-01' });
  const page = mountPage(Edit, { client, storage, controllers }); await page.load({}); await page.show(); await fill(page);
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises(); await page.hide();
  pending.resolve(null); await flushPromises(); expect(navigation).toEqual([]); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  await controllers.auth.signOut(); await flushPromises();
  expect(controllers.recipes.pending.value).toBeNull();
  page.wrapper.unmount(); controllers.recipes.dispose(); controllers.family.dispose(); controllers.invitations.dispose(); controllers.membership.dispose();
});
test('logout_then_same_account_login_cannot_restore_an_unsent_draft', async () => {
  const { client } = await setup(); vi.spyOn(client.account, 'signOut').mockResolvedValue();
  const page = mountPage(Edit, { client }); await page.load({}); await page.show(); await fill(page);
  await page.auth.signOut(); await page.auth.signIn(); await page.show();
  expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('');
  page.wrapper.unmount();
});
test('unknown_result_then_terminal_audit_rejection_unlocks_original_draft_and_allows_a_new_request', async () => {
  let rejected = false;
  const h = createHarness({ content: { async checkText() { return rejected ? 'rejected' : 'allowed'; } } });
  await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ requestId: 'page-family-create-01', name: '家' }); rejected = true;
  const send = vi.spyOn(client.recipes, 'create').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = mountPage(Edit, { client }); await page.load({}); await page.show(); await fill(page);
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-resume]').exists()).toBe(true);
  await page.wrapper.find('[data-resume]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-resume]').exists()).toBe(false);
  expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('家常汤');
  expect(page.wrapper.find('[data-title]').attributes('disabled')).toBeUndefined();
  rejected = false; await page.wrapper.find('[data-title]').setValue('重新编辑');
  await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
  expect(send).toHaveBeenCalledTimes(3);
  expect(send.mock.calls[0][0].requestId).toBe(send.mock.calls[1][0].requestId);
  expect(send.mock.calls[2][0].requestId).not.toBe(send.mock.calls[0][0].requestId);
  expect(await h.rows('recipes')).toHaveLength(1); page.wrapper.unmount();
});
