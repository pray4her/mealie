import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { cloudFixture } from '../support/cloud-platform';
import type { CloudFixtureOptions } from '../support/cloud-platform';

const methods = ['createList', 'renameList', 'removeList', 'listLists', 'getList', 'addItem', 'updateItem', 'removeItem', 'setChecked', 'listItems', 'getItem'] as const;
const scope = { familyId: 'home', generation: 'generation' };
const fields = { raw: '盐适量', name: null, quantity: null, unit: null, note: null };
function setup(options: CloudFixtureOptions = {}) {
  const f = cloudFixture('shopping-co', 'void', { optimistic: true, ...options }); const now = Date.now();
  f.rows.set('families/home', { _id: 'home', name: '家', ownerUid: 'alice', status: 'active', version: 1, createdAt: now, updatedAt: now });
  f.rows.set('family_members/alice', { _id: 'alice', ...scope, role: 'owner', mutationSeq: 0, joinedAt: now, updatedAt: now });
  return f;
}
test('shopping_schemas_deny_clientdb_and_index_family_parent_and_position', () => {
  for (const name of ['shopping_lists', 'shopping_items']) {
    const schema = JSON.parse(readFileSync(`uniCloud-alipay/database/${name}.schema.json`, 'utf8'));
    expect(schema.permission).toEqual({ read: false, create: false, update: false, delete: false });
    const indexes = JSON.parse(readFileSync(`uniCloud-alipay/database/${name}.index.json`, 'utf8'));
    expect(indexes[0].MgoKeySchema.MgoIndexKeys.map((key: { Name: string }) => key.Name)).toEqual(['familyId', name === 'shopping_lists' ? 'status' : 'listId', 'createdAt', '_id']);
  }
});
test('shopping_entry_has_exact_async_methods_and_enforces_auth_before_db', async () => {
  const f = setup(); expect(Object.keys(f.entry).sort()).toEqual([...methods].sort()); expect(f.transactions).toBe(0);
  for (const method of methods) {
    expect(f.entry[method].constructor.name).toBe('AsyncFunction');
    expect(await f.entry[method].call({ ...f.context, getUniIdToken: () => 'forged' }, {})).toEqual({ errCode: 'AUTH_REQUIRED' });
    expect(await f.entry[method].call(f.context, {}, undefined)).toEqual({ errCode: 'INVALID_INPUT' });
  }
  expect(f.transactions).toBe(0);
});
test('shopping_entry_uses_real_services_audit_receipts_and_parent_delete', async () => {
  const f = setup();
  const create = { ...scope, requestId: 'shopping-cloud-create', name: '采购' };
  const list = await f.entry.createList.call(f.context, create) as { errCode: number; data: { id: string } };
  expect(list).toMatchObject({ errCode: 0, data: { id: expect.stringMatching(/^[a-f0-9]{32}$/) } });
  expect(await f.entry.createList.call(f.context, create)).toMatchObject({ data: list.data });
  const added = await f.entry.addItem.call(f.context, { ...scope, requestId: 'shopping-cloud-add', listId: list.data.id, item: fields }) as { data: { id: string } };
  const check = { ...scope, requestId: 'shopping-cloud-check', listId: list.data.id, id: added.data.id, version: 1, checked: true };
  expect(await f.entry.setChecked.call(f.context, check)).toMatchObject({ errCode: 0, data: added.data });
  expect(await f.entry.setChecked.call(f.context, check)).toMatchObject({ errCode: 0 });
  expect(await f.entry.getItem.call(f.context, { listId: list.data.id, id: added.data.id })).toMatchObject({ data: { ...fields, version: 2, checked: true } });
  expect(f.contentCalls).toHaveLength(2);
  expect(await f.entry.removeList.call(f.context, { ...scope, requestId: 'shopping-cloud-remove', id: list.data.id, version: 1 })).toMatchObject({ errCode: 0 });
  expect(await f.entry.listItems.call(f.context, { listId: list.data.id })).toEqual({ errCode: 'NOT_FOUND' });
});
test('shopping_audit_rejection_is_terminal_and_no_unchecked_text_is_written', async () => {
  const f = setup(); f.setContent({ errCode: 'uni-sec-check-risk-content', errMsg: '', result: { suggest: 'risky', label: '风险' } });
  const input = { ...scope, requestId: 'shopping-cloud-reject', name: '拒绝' };
  expect(await f.entry.createList.call(f.context, input)).toEqual({ errCode: 'INVALID_INPUT' });
  f.setContent({ errCode: 0, errMsg: '', result: { suggest: 'pass', label: '正常' } });
  expect(await f.entry.createList.call(f.context, input)).toEqual({ errCode: 'INVALID_INPUT' });
  expect(f.contentCalls).toHaveLength(1); expect([...f.rows.keys()].filter(key => key.startsWith('shopping_lists/'))).toEqual([]);
});
test('shopping_commit_unknown_recovers_receipt_without_duplicate_records', async () => {
  const f = setup(); let lost = false;
  f.afterCommit(event => { if (!lost && event.writes.some(key => key.startsWith('shopping_lists/'))) { lost = true; throw new Error('lost commit acknowledgement'); } });
  const input = { ...scope, requestId: 'shopping-cloud-unknown', name: '采购' };
  expect(await f.entry.createList.call(f.context, input)).toMatchObject({ errCode: 0 });
  expect(await f.entry.createList.call(f.context, input)).toMatchObject({ errCode: 0 });
  expect([...f.rows.keys()].filter(key => key.startsWith('shopping_lists/'))).toHaveLength(1);
});
test('shopping_rechecks_membership_after_external_text_audit', async () => {
  const f = setup(); f.afterContent(() => f.rows.delete('family_members/alice'));
  expect(await f.entry.createList.call(f.context, { ...scope, requestId: 'shopping-cloud-revoke', name: '采购' })).toEqual({ errCode: 'FAMILY_REQUIRED' });
  expect([...f.rows.keys()].filter(key => key.startsWith('shopping_lists/'))).toEqual([]);
});
test('shopping_query_sdk_failure_is_not_an_empty_successful_page', async () => {
  const f = setup({ queryResult: { errCode: 'provider-failure', data: [] } });
  expect(await f.entry.listLists.call(f.context, {})).toEqual({ errCode: 'UNAVAILABLE' });
});
