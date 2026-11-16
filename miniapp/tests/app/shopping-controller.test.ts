import { createApp } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { provideAppClient } from '../../src/shared/app-client';
import { AppError } from '../../src/shared/errors';
import { createHarness } from '../support/harness';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });
const fields = { raw: '葱适量', name: null, quantity: null, unit: null, note: null };
async function setup() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  await client.family.create({ requestId: 'shopping-family-01', name: '家' }); const storage = createMemoryStorage(); let seq = 0;
  const app = provideAppClient(createApp(() => null), client, { storage, newRequestId: async () => 'shopping-write-' + (++seq) });
  await app.family.load(); const p = app.shopping;
  cleanups.push(() => { p?.dispose(); app.planning.dispose(); app.recipes.dispose(); app.media.dispose(); app.imports.dispose(); app.family.dispose(); app.invitations.dispose(); app.membership.dispose(); });
  return { h, client, storage, app, p };
}
test('shopping_is_wired_and_round_trips_lists_items_and_selection', async () => {
  const f = await setup(); expect(f.p).toBeDefined();
  const ack = await f.p.write('createList', { name: '采购' }); await f.p.select(ack.id);
  const item = await f.p.write('addItem', { listId: ack.id, item: fields }); await f.p.listItems();
  expect(f.p.items.value).toMatchObject([{ id: item.id, raw: '葱适量', checked: false }]);
  f.p.clear(); expect(f.p.items.value).toEqual([]); f.p.activate(); expect(f.p.selectedId.value).toBe(ack.id);
  await f.p.listItems(); expect(f.p.items.value).toHaveLength(1);
});
test('unknown_commit_retries_original_id_and_reads_the_current_state', async () => {
  const f = await setup(); const send = f.client.shopping.createList.bind(f.client.shopping);
  const calls = vi.spyOn(f.client.shopping, 'createList').mockImplementationOnce(async input => { await send(input); throw new AppError('UNAVAILABLE'); });
  await expect(f.p.write('createList', { name: '采购' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const pending = f.p.pending.value[0]; expect(pending).toBeDefined();
  await f.p.retry(pending.input.requestId); expect(calls.mock.calls[1][0]).toEqual(calls.mock.calls[0][0]); expect(await f.h.rows('shopping_lists')).toHaveLength(1);
  expect(f.p.pending.value).toEqual([]);
});
test('failed_persistence_sends_nothing', async () => {
  const f = await setup(); vi.spyOn(f.storage, 'set').mockImplementation(() => { throw new Error('full'); });
  await expect(f.p.write('createList', { name: '采购' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await f.h.rows('shopping_lists')).toEqual([]); expect(f.p.pending.value).toEqual([]);
});
test('different_items_can_write_concurrently_but_the_same_item_has_one_flight', async () => {
  const f = await setup(); const list = await f.p.write('createList', { name: '采购' }); await f.p.select(list.id);
  const a = await f.p.write('addItem', { listId: list.id, item: fields }); const b = await f.p.write('addItem', { listId: list.id, item: { ...fields, raw: '盐' } });
  const gate = deferCall(); const send = f.client.shopping.setChecked.bind(f.client.shopping);
  const calls = vi.spyOn(f.client.shopping, 'setChecked').mockImplementation(async input => { await gate.promise; return send(input); });
  const input = { listId: list.id, id: a.id, version: 1, checked: true };
  const first = f.p.write('setChecked', input); const same = f.p.write('setChecked', input); const second = f.p.write('setChecked', { ...input, id: b.id });
  await flushPromises(); expect(calls).toHaveBeenCalledTimes(2); gate.resolve(null);
  expect(await first).toEqual(await same); await second;
  expect((await f.client.shopping.listItems({ listId: list.id })).items.map(row => row.checked)).toEqual([true, true]);
});
test('hiding_ignores_late_reads_and_scope_change_clears_selection', async () => {
  const f = await setup(); const ack = await f.p.write('createList', { name: '采购' }); await f.p.select(ack.id);
  const gate = deferCall(); const read = f.client.shopping.listItems.bind(f.client.shopping);
  vi.spyOn(f.client.shopping, 'listItems').mockImplementation(async input => { await gate.promise; return read(input); });
  const pending = f.p.listItems(); f.p.clear(); gate.resolve(null); await pending; expect(f.p.items.value).toEqual([]);
  await f.app.auth.signOut(); expect(f.p.selectedId.value).toBeNull(); expect(f.p.pending.value).toEqual([]);
});
test('disposing_the_app_does_not_discard_an_unconfirmed_sent_request', async () => {
  const f = await setup(); vi.spyOn(f.client.shopping, 'createList').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  await expect(f.p.write('createList', { name: '采购' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const request = f.p.pending.value[0]; f.p.dispose();
  expect(f.storage.get('home.shopping.pending.v1:alice')).toEqual([request]);
});
test('an_old_selection_failure_cannot_clear_a_newly_selected_list', async () => {
  const f = await setup(); const a = await f.p.write('createList', { name: '第一张' }); const b = await f.p.write('createList', { name: '第二张' });
  const gate = deferCall(); const get = f.client.shopping.getList.bind(f.client.shopping);
  vi.spyOn(f.client.shopping, 'getList').mockImplementation(async value => { if (value === a.id) { await gate.promise; throw new AppError('NOT_FOUND'); } return get(value); });
  const old = f.p.select(a.id).catch(() => {}); await flushPromises(); await f.p.select(b.id); gate.resolve(null); await old;
  expect(f.p.selectedId.value).toBe(b.id); expect(f.p.selected.value?.name).toBe('第二张');
});
