import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';
import type { FamilyView } from 'home-contracts';

let sequence = 0;
const requestId = () => 'shopping-request-' + (++sequence);
const scope = (view: FamilyView) => ({ familyId: view.familyId, generation: view.generation });
const fields = (raw = '葱适量') => ({ raw, name: null, quantity: null, unit: null, note: null });
async function setup() {
  const h = createHarness();
  for (const uid of ['alice', 'bob', 'mallory']) await h.seedIdentity({ uid });
  const a = h.client('alice'); const b = h.client('bob'); const m = h.client('mallory');
  const family = await a.family.create({ requestId: requestId(), name: '采购家庭' });
  const invitation = await a.family.invite({ requestId: requestId() });
  await b.family.join({ requestId: requestId(), token: invitation.token });
  const member = (await b.family.current())!;
  const other = await m.family.create({ requestId: requestId(), name: '另一个家庭' });
  return { h, a, b, m, family, member, other,
    mutation: () => ({ ...scope(family), requestId: requestId() }),
    memberMutation: () => ({ ...scope(member), requestId: requestId() }),
  };
}
async function populated() {
  const f = await setup();
  const list = await f.a.shopping.createList({ ...f.mutation(), name: '本周采购' });
  const item = await f.a.shopping.addItem({ ...f.mutation(), listId: list.id, item: fields() });
  return { ...f, list, item };
}
test('shopping_is_a_real_app_client_capability', async () => {
  const f = await setup(); expect(f.a).toHaveProperty('shopping');
  expect(typeof f.a.shopping.createList).toBe('function');
});
test('multiple_lists_and_raw_items_are_shared_without_recipe_or_ai', async () => {
  const f = await populated(); const next = await f.b.shopping.createList({ ...f.memberMutation(), name: '周末采购' });
  expect(next.id).not.toBe(f.list.id);
  expect((await f.b.shopping.listLists({})).items.map(row => row.name)).toEqual(['本周采购', '周末采购']);
  expect(await f.b.shopping.getItem({ listId: f.list.id, id: f.item.id })).toMatchObject({ ...fields(), checked: false, version: 1 });
  expect(await f.h.rows('recipes')).toEqual([]); expect(await f.h.rows('import_jobs')).toEqual([]);
});
test('two_members_check_different_items_without_losing_either_result', async () => {
  const f = await populated(); const second = await f.a.shopping.addItem({ ...f.mutation(), listId: f.list.id, item: fields('鸡蛋') });
  await Promise.all([
    f.a.shopping.setChecked({ ...f.mutation(), listId: f.list.id, id: f.item.id, version: 1, checked: true }),
    f.b.shopping.setChecked({ ...f.memberMutation(), listId: f.list.id, id: second.id, version: 1, checked: true }),
  ]);
  expect((await f.a.shopping.listItems({ listId: f.list.id })).items.map(row => row.checked)).toEqual([true, true]);
});
test('checking_is_absolute_and_old_replays_do_not_flip_or_overwrite_newer_state', async () => {
  const f = await populated(); const input = { ...f.mutation(), listId: f.list.id, id: f.item.id, version: 1, checked: true };
  expect(await f.a.shopping.setChecked(input)).toEqual(f.item); await f.a.shopping.setChecked(input);
  await f.b.shopping.setChecked({ ...f.memberMutation(), listId: f.list.id, id: f.item.id, version: 2, checked: false });
  await f.a.shopping.setChecked(input);
  expect(await f.a.shopping.getItem({ listId: f.list.id, id: f.item.id })).toMatchObject({ checked: false, version: 3 });
  await expect(f.a.shopping.setChecked({ ...input, checked: false })).rejects.toMatchObject({ code: 'CONFLICT' });
});
test('stale_edits_and_same_item_checks_conflict_without_overwriting', async () => {
  const f = await populated();
  await f.a.shopping.updateItem({ ...f.mutation(), listId: f.list.id, id: f.item.id, version: 1, item: { ...fields('葱两根'), quantity: 2, unit: '根' } });
  await expect(f.b.shopping.setChecked({ ...f.memberMutation(), listId: f.list.id, id: f.item.id, version: 1, checked: true })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.b.shopping.updateItem({ ...f.memberMutation(), listId: f.list.id, id: f.item.id, version: 1, item: fields('姜') })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await f.a.shopping.getItem({ listId: f.list.id, id: f.item.id })).toMatchObject({ raw: '葱两根', checked: false, quantity: 2 });
});
test('lists_and_items_are_family_scoped_even_with_guessed_ids', async () => {
  const f = await populated();
  expect((await f.m.shopping.listLists({})).items).toEqual([]);
  await expect(f.m.shopping.getList(f.list.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.m.shopping.listItems({ listId: f.list.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.m.shopping.getItem({ listId: f.list.id, id: f.item.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.m.shopping.setChecked({ ...scope(f.other), requestId: requestId(), listId: f.list.id, id: f.item.id, version: 1, checked: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
test('parent_mismatch_and_deleted_parent_are_inaccessible_without_resurrection', async () => {
  const f = await populated(); const another = await f.a.shopping.createList({ ...f.mutation(), name: '其他清单' });
  await expect(f.a.shopping.getItem({ listId: another.id, id: f.item.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const removal = { ...f.memberMutation(), id: f.list.id, version: 1 };
  await f.b.shopping.removeList(removal); await f.b.shopping.removeList(removal);
  await expect(f.a.shopping.getList(f.list.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.a.shopping.getItem({ listId: f.list.id, id: f.item.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.a.shopping.addItem({ ...f.mutation(), listId: f.list.id, item: fields('盐') })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await f.h.rows<{ status: string }>('shopping_lists')).filter(row => row.status === 'deleted')).toHaveLength(1);
  expect(await f.h.rows('shopping_items')).toHaveLength(1);
});
test('rename_is_versioned_and_item_delete_replay_never_recreates', async () => {
  const f = await populated();
  await f.b.shopping.renameList({ ...f.memberMutation(), id: f.list.id, version: 1, name: '明天买' });
  await expect(f.a.shopping.removeList({ ...f.mutation(), id: f.list.id, version: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  const remove = { ...f.mutation(), listId: f.list.id, id: f.item.id, version: 1 };
  await f.a.shopping.removeItem(remove); await f.a.shopping.removeItem(remove);
  expect((await f.a.shopping.listItems({ listId: f.list.id })).items).toEqual([]);
  expect(await f.a.shopping.getList(f.list.id)).toMatchObject({ name: '明天买', version: 2 });
});
test('removed_members_cannot_read_or_replay_receipts', async () => {
  const f = await populated(); const input = { ...f.memberMutation(), listId: f.list.id, id: f.item.id, version: 1, checked: true };
  await f.b.shopping.setChecked(input);
  await f.a.family.removeMember({ ...f.mutation(), uid: 'bob', targetGeneration: f.member.generation });
  await expect(f.b.shopping.getList(f.list.id)).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  await expect(f.b.shopping.setChecked(input)).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
});
test.each([0, -1, 1_000_001, Infinity, NaN, '2'])('invalid_quantity_%s_is_rejected_without_an_item', async quantity => {
  const f = await populated();
  await expect(f.a.shopping.addItem({ ...f.mutation(), listId: f.list.id, item: { ...fields(), quantity } } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('shopping_items')).toHaveLength(1);
});
test('limits_empty_raw_and_untrusted_fields_are_enforced', async () => {
  const f = await populated();
  for (const item of [{ ...fields(), raw: ' ' }, { ...fields(), raw: '葱'.repeat(501) }, { ...fields(), name: '葱'.repeat(101) }, { ...fields(), unit: '克'.repeat(41) }, { ...fields(), note: '注'.repeat(501) }, { ...fields(), checked: true }]) {
    await expect(f.a.shopping.addItem({ ...f.mutation(), listId: f.list.id, item } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  await expect(f.a.shopping.createList({ ...f.mutation(), name: '名'.repeat(41) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('pagination_is_stable_and_cursors_cannot_cross_lists_or_identities', async () => {
  const f = await populated();
  const second = await f.a.shopping.addItem({ ...f.mutation(), listId: f.list.id, item: fields('姜') });
  const page = await f.a.shopping.listItems({ listId: f.list.id, limit: 1 });
  expect(page.items.map(row => row.id)).toEqual([f.item.id]); expect(page.nextCursor).toBeTruthy();
  expect((await f.a.shopping.listItems({ listId: f.list.id, limit: 1, cursor: page.nextCursor! })).items.map(row => row.id)).toEqual([second.id]);
  await expect(f.b.shopping.listItems({ listId: f.list.id, cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const other = await f.a.shopping.createList({ ...f.mutation(), name: '另一张' });
  await expect(f.a.shopping.listItems({ listId: other.id, cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('checking_more_than_ten_times_uses_its_own_limit', async () => {
  const f = await populated();
  for (let version = 1; version <= 15; version++) await f.a.shopping.setChecked({ ...f.mutation(), listId: f.list.id, id: f.item.id, version, checked: version % 2 === 1 });
  expect(await f.a.shopping.getItem({ listId: f.list.id, id: f.item.id })).toMatchObject({ version: 16, checked: true });
});
