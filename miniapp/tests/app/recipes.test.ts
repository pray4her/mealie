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

async function seedRecipe(client: Awaited<ReturnType<typeof setup>>['client'], title = '家常汤', tags = ['家常']) {
  const view = (await client.family.current())!;
  return client.recipes.create({ requestId: 'page-create-' + title, familyId: view.familyId, generation: view.generation,
    recipe: { title, description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
      ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags } });
}

test('list_search_is_explicit_and_combines_filters_and_favorites_then_removes_unmarked_row', async () => {
  const { client } = await setup(); await seedRecipe(client, 'Soup', ['家常']); await seedRecipe(client, 'Noodles', ['面']);
  const send = vi.spyOn(client.recipes, 'list'); const page = mountPage(List, { client }); await page.show();
  await page.wrapper.find('[data-query]').setValue('sOuP'); await page.wrapper.find('[data-tag]').setValue('家常');
  expect(send).toHaveBeenCalledTimes(1);
  await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
  expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['Soup']);
  await page.wrapper.find('[data-favorite]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-favorite]').text()).toBe('取消收藏');
  await page.wrapper.find('[data-favorites]').trigger('click'); await flushPromises();
  expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(1);
  await page.wrapper.find('[data-favorite]').trigger('click'); await flushPromises();
  expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0);
  await page.hide(); await page.show();
  expect((page.wrapper.find('[data-query]').element as HTMLInputElement).value).toBe('soup'); page.wrapper.unmount();
});

test('title_and_exact_tag_search_fields_keep_visible_labels_while_typing', async () => {
  const { client } = await setup(); await seedRecipe(client, 'test123', ['22']);
  const page = mountPage(List, { client }); await page.show();
  try {
    await page.wrapper.find('[data-query]').setValue('123');
    expect(page.wrapper.findAll('.filter-label').map(label => label.text())).toEqual(['搜索标题', '精确标签（可选）']);
    await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['test123']);
    await page.wrapper.find('[data-tag]').setValue('22');
    expect(page.wrapper.findAll('.filter-label').map(label => label.text())).toEqual(['搜索标题', '精确标签（可选）']);
    await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['test123']);
    await page.wrapper.find('[data-tag]').setValue('123');
    await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0);
  } finally { page.wrapper.unmount(); }
});

test('empty_search_segment_offers_continuation_and_duplicate_more_taps_do_not_duplicate_results', async () => {
  const { client } = await setup(); const row = await seedRecipe(client, 'Soup');
  const send = vi.spyOn(client.recipes, 'list').mockResolvedValueOnce({ items: [], nextCursor: 'cursor' });
  const gate = deferCall(); const page = mountPage(List, { client }); await page.show();
  expect(page.wrapper.text()).toContain('继续查找'); expect(page.wrapper.text()).not.toContain('没有符合');
  send.mockImplementationOnce(async () => { await gate.promise; return { items: [row], nextCursor: null }; });
  await Promise.all([page.wrapper.find('[data-more]').trigger('click'), page.wrapper.find('[data-more]').trigger('click')]);
  expect(send).toHaveBeenCalledTimes(2); gate.resolve(null); await flushPromises();
  expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(1); page.wrapper.unmount();
});

test('late_filter_response_and_hidden_response_cannot_replace_current_results', async () => {
  const { client } = await setup(); const row = await seedRecipe(client, 'Soup');
  const send = vi.spyOn(client.recipes, 'list'); const page = mountPage(List, { client }); await page.show();
  const gate = deferCall(); send.mockImplementationOnce(async () => { await gate.promise; return { items: [row], nextCursor: 'old' }; });
  await page.wrapper.find('[data-query]').setValue('Soup'); await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
  await page.wrapper.find('[data-query]').setValue('missing'); await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
  gate.resolve(null); await flushPromises();
  expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0); expect(page.controllers.recipes.nextCursor.value).toBeNull();
  await page.hide(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test('unloading_a_hidden_recipe_page_cannot_discard_the_current_lists_search_response', async () => {
  const { client } = await setup(); const row = await seedRecipe(client, 'testRecipe');
  const old = mountPage(Detail, { client }); await old.load({ id: row.id }); await old.show(); await old.hide();
  const page = mountPage(List, { client, controllers: old.controllers }); await page.show();
  const list = client.recipes.list.bind(client.recipes); const gate = deferCall();
  vi.spyOn(client.recipes, 'list').mockImplementationOnce(async input => { const result = await list(input); await gate.promise; return result; });
  try {
    await page.wrapper.find('[data-query]').setValue('test'); await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
    await old.unload(); gate.resolve(null); await flushPromises();
    expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
    expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['testRecipe']);
    expect(page.wrapper.text()).not.toContain('没有符合条件的菜谱');
  } finally { page.wrapper.unmount(); old.wrapper.unmount(); }
});

test('unloading_a_hidden_editor_cannot_erase_a_new_recipe_from_the_current_list', async () => {
  const { client } = await setup();
  const edit = mountPage(Edit, { client }); await edit.load({}); await edit.show(); await fill(edit);
  await edit.wrapper.find('[data-save]').trigger('click'); await flushPromises(); await edit.hide();
  const page = mountPage(List, { client, controllers: edit.controllers });
  try {
    await page.show(); await edit.unload();
    expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['家常汤']);
  } finally { page.wrapper.unmount(); edit.wrapper.unmount(); }
});

test('favorite_lost_confirmation_survives_cold_start_and_retries_same_intent_without_using_recipe_draft', async () => {
  const { h, client } = await setup(); const row = await seedRecipe(client, 'Soup'); const storage = createMemoryStorage();
  const actual = client.recipes.favorite.bind(client.recipes); const send = vi.spyOn(client.recipes, 'favorite').mockImplementationOnce(async input => { await actual(input); throw new AppError('UNAVAILABLE'); });
  const page = mountPage(Detail, { client, storage }); await page.load({ id: row.id }); await page.show();
  await Promise.all([page.wrapper.find('[data-favorite]').trigger('click'), page.wrapper.find('[data-favorite]').trigger('click')]); await flushPromises();
  expect(send).toHaveBeenCalledTimes(1); expect(page.wrapper.find('[data-resume-favorite]').exists()).toBe(true);
  expect(page.controllers.recipes.pending.value).toBeNull(); page.wrapper.unmount();
  const restored = mountPage(Detail, { client, storage }); await restored.load({ id: row.id }); await restored.show();
  await restored.wrapper.find('[data-resume-favorite]').trigger('click'); await flushPromises();
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  expect(await h.rows('recipe_favorites')).toHaveLength(1); expect(restored.wrapper.find('[data-resume-favorite]').exists()).toBe(false);
  expect(restored.wrapper.find('[data-favorite]').text()).toBe('取消收藏'); restored.wrapper.unmount();
});

test('logout_discards_pending_favorite_and_late_success_cannot_publish_private_state', async () => {
  const { client } = await setup(); const row = await seedRecipe(client, 'Soup'); const storage = createMemoryStorage(); const gate = deferCall();
  const actual = client.recipes.favorite.bind(client.recipes); vi.spyOn(client.recipes, 'favorite').mockImplementation(async input => { await gate.promise; return actual(input); });
  const page = mountPage(Detail, { client, storage }); await page.load({ id: row.id }); await page.show();
  await page.wrapper.find('[data-favorite]').trigger('click'); await flushPromises();
  await page.auth.signOut(); gate.resolve(null); await flushPromises();
  expect(page.controllers.recipes.recipe.value).toBeNull(); expect(page.controllers.recipes.pendingFavorite.value).toBeNull();
  expect(storage.get('home.recipes.favorite.v1:alice')).toBeUndefined(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test('favorite_confirmation_supersedes_an_older_list_snapshot', async () => {
  const { client } = await setup(); const row = await seedRecipe(client, 'Soup'); const other = await seedRecipe(client, 'Noodles'); const view = (await client.family.current())!;
  await client.recipes.favorite({ requestId: 'initial-favorite-01', familyId: view.familyId, generation: view.generation, id: row.id, enabled: true });
  await client.recipes.favorite({ requestId: 'initial-favorite-02', familyId: view.familyId, generation: view.generation, id: other.id, enabled: true });
  const list = client.recipes.list.bind(client.recipes); const favorite = client.recipes.favorite.bind(client.recipes);
  const favoriteGate = deferCall(); const listGate = deferCall();
  const page = mountPage(List, { client }); await page.show();
  await page.wrapper.find('[data-favorites]').trigger('click'); await flushPromises();
  vi.spyOn(client.recipes, 'favorite').mockImplementationOnce(async input => { await favoriteGate.promise; return favorite(input); });
  await page.wrapper.findAll('[data-favorite]')[1].trigger('click'); await flushPromises();
  vi.spyOn(client.recipes, 'list').mockImplementationOnce(async input => { const snapshot = await list(input); await listGate.promise; return snapshot; });
  await page.wrapper.find('[data-search]').trigger('click'); await flushPromises();
  favoriteGate.resolve(null); await flushPromises(); expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['Noodles']);
  listGate.resolve(null); await flushPromises(); expect(page.wrapper.findAll('[data-recipe]').map(item => item.text())).toEqual(['Noodles']);
  expect(page.controllers.recipes.nextCursor.value).toBeNull(); page.wrapper.unmount();
});

test('visible_retry_uses_original_request_while_a_hidden_favorite_call_is_still_pending', async () => {
  const { client } = await setup(); const row = await seedRecipe(client, 'Soup'); const favorite = client.recipes.favorite.bind(client.recipes);
  const gate = deferCall(); const send = vi.spyOn(client.recipes, 'favorite').mockImplementationOnce(async input => { await gate.promise; return favorite(input); });
  const page = mountPage(Detail, { client }); await page.load({ id: row.id }); await page.show();
  await page.wrapper.find('[data-favorite]').trigger('click'); await flushPromises(); await page.hide(); await page.show();
  await page.wrapper.find('[data-resume-favorite]').trigger('click'); await flushPromises();
  gate.resolve(null); await flushPromises();
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  expect(page.wrapper.find('[data-protected]').exists()).toBe(true); expect(page.wrapper.find('[data-favorite]').text()).toBe('取消收藏');
  expect(page.wrapper.find('[data-resume-favorite]').exists()).toBe(false); page.wrapper.unmount();
});
