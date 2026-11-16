// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Component } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { createHarness } from '../support/harness';
import { mountPage } from '../support/uni-stubs';
import { deferCall } from '../support/sdk-transport';
import { AppError } from '../../src/shared/errors';
const pages = import.meta.glob<{ default: Component }>('../../src/pages/shopping/*.vue');
const cleanups: (() => void)[] = [];
beforeEach(() => vi.stubGlobal('uni', { showModal: vi.fn(async () => ({ confirm: true })), navigateTo: vi.fn(), switchTab: vi.fn(), reLaunch: vi.fn(),
  enableAlertBeforeUnload: vi.fn(), disableAlertBeforeUnload: vi.fn(), pageScrollTo: vi.fn(), stopPullDownRefresh: vi.fn() }));
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const family = await client.family.create({ requestId: 'shopping-ui-family', name: '家' }); const scope = { familyId: family.familyId, generation: family.generation };
  const list = await client.shopping.createList({ ...scope, requestId: 'shopping-ui-list', name: '本周采购' }); return { h, client, scope, list };
}
async function render(name: string, f: Awaited<ReturnType<typeof setup>>, query: Record<string, string> = {}) {
  const load = pages['../../src/pages/shopping/' + name + '.vue']; expect(load, 'implemented shopping page').toBeTypeOf('function');
  const page = mountPage((await load()).default, { client: f.client }); cleanups.push(() => page.wrapper.unmount()); await page.load(query); await page.show(); return page;
}
async function click(page: ReturnType<typeof mountPage>, selector: string) { await page.wrapper.get(selector).trigger('click'); await flushPromises(); }
test('shopping_index_shows_real_raw_items_and_one_checkbox_target_with_separate_edit', async () => {
  const f = await setup(); await f.client.shopping.addItem({ ...f.scope, requestId: 'shopping-ui-item', listId: f.list.id, item: { raw: '葱适量', name: null, quantity: null, unit: null, note: null } });
  const page = await render('index', f); expect(page.wrapper.text()).toContain('本周采购'); expect(page.wrapper.text()).toContain('葱适量');
  expect(page.wrapper.findAll('[aria-role="checkbox"]')).toHaveLength(1);
  expect(page.wrapper.get('[data-check-item]').attributes()).toMatchObject({ 'aria-label': '标记已购葱适量', 'aria-checked': 'false', 'aria-disabled': 'false' });
  await click(page, '[data-edit-item]');
  expect((await f.client.shopping.listItems({ listId: f.list.id })).items[0].checked).toBe(false);
  const gate = deferCall(); const send = f.client.shopping.setChecked.bind(f.client.shopping);
  const check = vi.spyOn(f.client.shopping, 'setChecked').mockImplementation(async input => { await gate.promise; return send(input); });
  await click(page, '[data-check-item]'); expect(page.wrapper.get('[data-check-item]').attributes('aria-disabled')).toBe('true');
  await click(page, '[data-check-item]'); expect(check).toHaveBeenCalledTimes(1);
  gate.resolve(null); await flushPromises(); expect((await f.client.shopping.listItems({ listId: f.list.id })).items[0].checked).toBe(true);
  expect(page.wrapper.get('[data-check-item]').attributes()).toMatchObject({ 'aria-label': '取消已购葱适量', 'aria-checked': 'true', 'aria-disabled': 'false' });
  expect(page.wrapper.text()).toContain('已经买好');
});
test('item_form_saves_raw_only_and_locates_invalid_quantity_without_sending', async () => {
  const f = await setup(); const page = await render('item-edit', f, { listId: f.list.id });
  await page.wrapper.get('[data-field="raw"]').setValue('香菜适量'); await page.wrapper.get('[data-field="quantity"]').setValue('0');
  await click(page, '[data-save]'); expect(page.wrapper.text()).toContain('数量须大于'); expect(await f.h.rows('shopping_items')).toHaveLength(0);
  await page.wrapper.get('[data-field="quantity"]').setValue(''); await click(page, '[data-save]');
  expect(await f.h.rows('shopping_items')).toMatchObject([{ raw: '香菜适量', quantity: null }]); expect(page.wrapper.text()).toContain('已保存');
});
test('list_form_renames_and_delete_confirmation_uses_saved_name', async () => {
  const f = await setup(); const page = await render('list-edit', f, { id: f.list.id });
  await page.wrapper.get('[data-field="name"]').setValue('未保存名称'); await click(page, '[data-remove]');
  expect(uni.showModal).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('本周采购') }));
  expect(page.wrapper.text()).toContain('已删除'); await expect(f.client.shopping.getList(f.list.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
test('a_pre_hide_ack_does_not_hide_the_current_recovery_entry_after_returning', async () => {
  const f = await setup(); const gate = deferCall(); const send = f.client.shopping.createList.bind(f.client.shopping);
  vi.spyOn(f.client.shopping, 'createList').mockImplementation(async input => { const ack = await send(input); await gate.promise; return ack; });
  const page = await render('list-edit', f); await page.wrapper.get('[data-field="name"]').setValue('新清单'); await click(page, '[data-save]');
  await page.hide(); await page.show(); expect(page.wrapper.find('[data-pending]').exists()).toBe(true);
  gate.resolve(null); await flushPromises(); expect(page.wrapper.find('[data-pending]').exists()).toBe(true);
  expect(page.controllers.shopping.pending.value).toHaveLength(1);
});
test('current_visibility_family_revocation_still_navigates_to_onboarding', async () => {
  const f = await setup(); vi.spyOn(f.client.shopping, 'createList').mockImplementation(async () => {
    await f.h.database.transaction(tx => tx.remove('family_members', 'alice')); throw new AppError('FAMILY_REQUIRED');
  });
  const page = await render('list-edit', f); await page.wrapper.get('[data-field="name"]').setValue('新清单'); await click(page, '[data-save]');
  expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/family/onboarding' });
});
