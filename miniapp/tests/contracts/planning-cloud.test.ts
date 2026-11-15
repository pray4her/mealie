import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import type { Page, PlanEntry } from 'home-contracts';
import { cloudFixture } from '../support/cloud-platform';
import type { CloudFixtureOptions } from '../support/cloud-platform';

const methods = ['add', 'list', 'get', 'update', 'remove'] as const;
const recipeId = 'a'.repeat(32); const planId = 'b'.repeat(32);
const scope = { familyId: 'home', generation: 'generation' };
const fields = { date: '2026-11-15', meal: 'dinner', targetServings: null };
const range = { from: '2026-11-01', to: '2026-11-30' };
const add = { ...scope, ...fields, recipeId, requestId: 'cloud-plan-add-0001' };
const update = { ...scope, ...fields, id: planId, version: 1, requestId: 'cloud-plan-update-01' };
const remove = { ...scope, id: planId, version: 1, requestId: 'cloud-plan-remove-01' };
const inputs = { add, list: range, get: planId, update, remove };
function record(id = planId, overrides: Record<string, unknown> = {}) {
  return { _id: id, ...fields, familyId: 'home', createdBy: 'alice', recipeId, titleSnapshot: '汤', version: 1, createdAt: 7, updatedAt: 7, ...overrides };
}
function setup(ack: 'object' | 'void' = 'void', options: CloudFixtureOptions = {}) {
  const f = cloudFixture('planning-co', ack, { optimistic: true, ...options }); const now = Date.now();
  f.rows.set('families/home', { _id: 'home', name: '家', ownerUid: 'alice', status: 'active', version: 1, createdAt: now, updatedAt: now });
  f.rows.set('family_members/alice', { _id: 'alice', ...scope, role: 'owner', mutationSeq: 0, joinedAt: now, updatedAt: now });
  f.rows.set('recipes/' + recipeId, { _id: recipeId, slug: 'soup', title: '汤', description: '说明', baseServings: null, prepMinutes: 0, cookMinutes: null,
    ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: ['家常'],
    familyId: 'home', createdBy: 'alice', version: 1, createdAt: now, updatedAt: now, imageIds: ['private-cover'],
    source: { kind: 'manual', url: null, importJobId: null, warnings: [] } });
  return f;
}
type Fixture = ReturnType<typeof setup>;
const planRows = (f: Fixture) => [...f.rows.entries()].filter(([key]) => key.startsWith('meal_plans/'));
const receipts = (f: Fixture) => [...f.rows.entries()].filter(([key, row]) => key.startsWith('mutation_receipts/') && String(row.operation).startsWith('plan-')).map(([, row]) => row);
const writesPlan = (event: { writes: readonly string[] }) => event.writes.some(key => key.startsWith('meal_plans/'));
function makeAliceMember(f: Fixture) {
  f.rows.set('families/home', { ...f.rows.get('families/home'), ownerUid: 'bob' });
  f.rows.set('family_members/alice', { ...f.rows.get('family_members/alice'), role: 'member' });
  f.rows.set('family_members/bob', { ...f.rows.get('family_members/alice'), _id: 'bob', role: 'owner' });
}

test('planning_transpiled_entry_exports_exactly_five_async_methods_without_eager_sdk_work', () => {
  const f = setup();
  expect(Object.keys(f.entry).sort()).toEqual(['add', 'get', 'list', 'remove', 'update']);
  for (const method of methods) expect(f.entry[method].constructor.name).toBe('AsyncFunction');
  expect(f.sdkImports).toBe(0); expect(f.transactions).toBe(0); expect(f.reads).toEqual([]);
});
test('planning_package_resolves_real_local_dependencies_and_cloud_tsc_includes_the_entry', () => {
  const folder = resolve('uniCloud-alipay/cloudfunctions/planning-co');
  const pkg = JSON.parse(readFileSync(resolve(folder, 'package.json'), 'utf8'));
  expect(Object.keys(pkg.dependencies).sort()).toEqual(['home-contracts', 'home-family', 'home-kernel', 'home-planning']);
  for (const [name, dependency] of Object.entries(pkg.dependencies)) {
    expect(dependency).toBe('file:../common/' + name);
    expect(JSON.parse(readFileSync(resolve(folder, String(dependency).slice(5), 'package.json'), 'utf8')).name).toBe(name);
  }
  const config = ts.readConfigFile(resolve('tsconfig.cloud.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('.'));
  expect(parsed.errors).toEqual([]);
  expect(parsed.fileNames.map(path => resolve(path))).toContain(resolve(folder, 'index.obj.ts'));
});
test.each(['void', 'object'] as const)('planning_real_entry_crud_receipts_versions_and_null_remove_with_%s_commit', async ack => {
  const f = setup(ack);
  const created = await f.entry.add.call(f.context, add) as { data: PlanEntry };
  expect(created).toMatchObject({ errCode: 0, data: { ...fields, recipeId, familyId: 'home', createdBy: 'alice', titleSnapshot: '汤', version: 1, sourceAvailable: true, coverImageId: 'private-cover' }, newToken: { token: 'renewed-token', tokenExpired: expect.any(Number) } });
  expect(created.data.id).toMatch(/^[a-f0-9]{32}$/); expect(created.data.createdAt).toBeGreaterThan(7);
  expect(await f.entry.add.call(f.context, add)).toMatchObject({ data: created.data }); expect(planRows(f)).toHaveLength(1);
  const change = { ...update, id: created.data.id, meal: 'lunch', targetServings: 2.5 };
  expect(await f.entry.update.call(f.context, change)).toMatchObject({ errCode: 0, data: { id: created.data.id, date: fields.date, meal: 'lunch', targetServings: 2.5, version: 2 } });
  expect(await f.entry.update.call(f.context, { ...change, requestId: 'cloud-plan-update-02' })).toEqual({ errCode: 'CONFLICT' });
  expect(await f.entry.get.call(f.context, created.data.id)).toMatchObject({ errCode: 0, data: { id: created.data.id, version: 2, meal: 'lunch' } });
  expect(await f.entry.list.call(f.context, range)).toMatchObject({ errCode: 0, data: { items: [{ id: created.data.id, version: 2 }], nextCursor: null } });
  const deletion = { ...remove, id: created.data.id, version: 2 };
  const removed = await f.entry.remove.call(f.context, deletion);
  expect(JSON.parse(JSON.stringify(removed))).toMatchObject({ errCode: 0, data: null, newToken: { token: 'renewed-token' } });
  expect(await f.entry.remove.call(f.context, deletion)).toMatchObject({ errCode: 0, data: null });
  expect(await f.entry.get.call(f.context, created.data.id)).toEqual({ errCode: 'NOT_FOUND' });
  expect(await f.entry.add.call(f.context, { ...add, meal: 'breakfast' })).toEqual({ errCode: 'CONFLICT' });
  expect(receipts(f)).toHaveLength(3); expect(planRows(f)).toHaveLength(0);
  expect(f.contentCalls).toEqual([]); expect(f.contexts).toEqual([]);
  expect(f.projections.every(call => !Object.hasOwn(call.fields, 'wx_openid'))).toBe(true);
  expect(f.checks.slice(0, 4)).toEqual([{ token: 'verified-token', autoRefresh: false }, { token: 'verified-token', autoRefresh: true }, { token: 'verified-token', autoRefresh: false }, { token: 'verified-token', autoRefresh: false }]);
});
test.each(methods)('planning_%s_rejects_wrong_app_platform_missing_or_forged_token_before_transactions', async method => {
  const f = setup();
  for (const context of [
    { ...f.context, getClientInfo: () => ({ appId: 'forged', uniPlatform: 'mp-weixin' }) },
    { ...f.context, getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'web' }) },
    { ...f.context, getUniIdToken: () => undefined }, { ...f.context, getUniIdToken: () => 'forged' },
  ]) expect(await f.entry[method].call(context, inputs[method])).toEqual({ errCode: 'AUTH_REQUIRED' });
  expect(f.transactions).toBe(0); expect(f.contentCalls).toEqual([]);
});
test.each(methods)('planning_%s_rejects_even_undefined_extra_argument_before_transactions', async method => {
  const f = setup();
  expect(await f.entry[method].call(f.context, inputs[method], undefined)).toEqual({ errCode: 'INVALID_INPUT' });
  expect(f.transactions).toBe(0);
});
test.each(methods)('planning_%s_requires_current_family_membership', async method => {
  const f = setup(); f.rows.delete('family_members/alice');
  expect(await f.entry[method].call(f.context, inputs[method])).toEqual({ errCode: 'FAMILY_REQUIRED' });
  expect(planRows(f)).toEqual([]); expect(receipts(f)).toEqual([]);
});
test.each([
  ['add', { ...add, title: 'unapproved free title' }], ['add', { ...add, date: '2026-02-29' }],
  ['add', { ...add, meal: 'snack' }], ['add', { ...add, targetServings: 0 }], ['add', { ...add, targetServings: 10001 }],
  ['add', { ...add, recipeId: 'wrong' }], ['add', { ...add, requestId: 'short' }],
  ['list', { from: '2026-01-01', to: '2026-02-01' }], ['list', { from: '2026-11-16', to: '2026-11-15' }],
  ['list', { ...range, limit: 0 }], ['list', { ...range, limit: 21 }], ['list', { ...range, limit: 1.5 }],
  ['list', { ...range, familyId: 'other' }], ['list', { ...range, cursor: 'forged' }],
  ['get', { id: planId }], ['update', { ...update, version: Number.MAX_SAFE_INTEGER }],
  ['update', { ...update, recipeId }], ['remove', { ...remove, version: 0 }], ['remove', { ...remove, date: fields.date }],
] as const)('planning_entry_validates_%s_bounds_%j', async (method, input) => {
  const f = setup();
  expect(await f.entry[method].call(f.context, input)).toEqual({ errCode: 'INVALID_INPUT' });
  expect(planRows(f)).toEqual([]); expect(receipts(f)).toEqual([]);
});
test('planning_entry_enforces_source_and_plan_family_isolation_and_mutation_generation', async () => {
  const f = setup(); f.rows.set('meal_plans/' + planId, record(planId, { familyId: 'other' }));
  for (const method of ['get', 'update', 'remove'] as const) expect(await f.entry[method].call(f.context, inputs[method])).toEqual({ errCode: 'NOT_FOUND' });
  f.rows.set('recipes/' + recipeId, { ...f.rows.get('recipes/' + recipeId), familyId: 'other' });
  expect(await f.entry.add.call(f.context, add)).toEqual({ errCode: 'NOT_FOUND' });
  for (const mismatch of [{ familyId: 'other' }, { generation: 'old-generation' }]) {
    expect(await f.entry.add.call(f.context, { ...add, ...mismatch })).toEqual({ errCode: 'CONFLICT' });
  }
  expect(receipts(f)).toEqual([]);
});
test('planning_entry_paginates_all_rows_with_family_date_bounds_and_equal_date_timestamp_id_ties', async () => {
  const f = setup();
  const ids = Array.from({ length: 25 }, (_, n) => n.toString(16).padStart(32, '0'));
  for (const id of ids.slice().reverse()) f.rows.set('meal_plans/' + id, record(id));
  for (const [digit, overrides] of [['c', { date: '2026-10-31' }], ['d', { date: '2026-12-01' }], ['e', { familyId: 'other' }]] as const) {
    f.rows.set('meal_plans/' + digit.repeat(32), record(digit.repeat(32), overrides));
  }
  const first = await f.entry.list.call(f.context, range) as { data: Page<PlanEntry> };
  expect(first).toMatchObject({ errCode: 0 }); expect(first.data.items.map(item => item.id)).toEqual(ids.slice(0, 20));
  expect(first.data.nextCursor).toEqual(expect.any(String));
  const second = await f.entry.list.call(f.context, { ...range, cursor: first.data.nextCursor }) as { data: Page<PlanEntry> };
  expect(second.data.items.map(item => item.id)).toEqual(ids.slice(20)); expect(second.data.nextCursor).toBeNull();
  expect(await f.entry.list.call(f.context, { from: '2026-11-02', to: range.to, cursor: first.data.nextCursor })).toEqual({ errCode: 'INVALID_INPUT' });
  f.rows.set('family_members/alice', { ...f.rows.get('family_members/alice'), generation: 'new-generation' });
  expect(await f.entry.list.call(f.context, { ...range, cursor: first.data.nextCursor })).toEqual({ errCode: 'INVALID_INPUT' });
});
test('planning_entry_rechecks_candidates_after_query_and_can_continue_an_empty_page', async () => {
  const f = setup(); const secondId = 'c'.repeat(32);
  f.rows.set('meal_plans/' + planId, record()); f.rows.set('meal_plans/' + secondId, record(secondId));
  f.afterQuery(() => { f.rows.delete('meal_plans/' + planId); });
  const first = await f.entry.list.call(f.context, { ...range, limit: 1 }) as { data: Page<PlanEntry> };
  expect(first).toMatchObject({ errCode: 0, data: { items: [], nextCursor: expect.any(String) } });
  expect(await f.entry.list.call(f.context, { ...range, limit: 1, cursor: first.data.nextCursor })).toMatchObject({ data: { items: [{ id: secondId }], nextCursor: null } });
});
test.each([null, { data: {} }, { errCode: 'FAILED', data: [] }, { data: [null] },
  { data: [{ _id: planId, familyId: 'other', date: fields.date, createdAt: 7 }] },
  { data: [{ _id: planId, familyId: 'home', date: fields.date, createdAt: -1 }] },
])('planning_entry_hides_malformed_query_envelopes_and_candidates_%j', async queryResult => {
  const f = setup('void', { queryResult });
  expect(await f.entry.list.call(f.context, range)).toEqual({ errCode: 'UNAVAILABLE' });
});
test('planning_entry_keeps_snapshot_text_but_derives_source_availability_and_private_cover', async () => {
  const f = setup(); f.rows.set('meal_plans/' + planId, record()); f.rows.delete('recipes/' + recipeId);
  expect(await f.entry.get.call(f.context, planId)).toMatchObject({ data: { titleSnapshot: '汤', sourceAvailable: false, coverImageId: null } });
  expect(await f.entry.update.call(f.context, update)).toMatchObject({ data: { version: 2, sourceAvailable: false, coverImageId: null } });
});
test.each(['get', 'list', 'add', 'update', 'remove'] as const)('planning_%s_revalidates_token_before_return_without_leaking_data_or_new_token', async method => {
  const f = setup(); f.rows.set('meal_plans/' + planId, record());
  if (method === 'list') f.afterQuery(() => f.revoke());
  else f.afterCommit(event => {
    if (method === 'get' ? event.reads.includes('meal_plans/' + planId) : writesPlan(event)) f.revoke();
  });
  expect(await f.entry[method].call(f.context, inputs[method])).toEqual({ errCode: 'AUTH_REQUIRED' });
});
test('planning_entry_revalidates_token_before_mutation_not_just_before_return', async () => {
  const f = setup();
  f.afterCommit(event => { if (event.writes.some(key => key.startsWith('request_limits/'))) f.revoke(); });
  expect(await f.entry.add.call(f.context, add)).toEqual({ errCode: 'AUTH_REQUIRED' });
  expect(planRows(f)).toEqual([]); expect(receipts(f)).toEqual([]);
});
test('planning_entry_hides_success_after_member_removal_and_does_not_restore_membership', async () => {
  const f = setup(); makeAliceMember(f);
  f.afterCommit(event => { if (writesPlan(event)) f.rows.delete('family_members/alice'); });
  expect(await f.entry.add.call(f.context, add)).toEqual({ errCode: 'FAMILY_REQUIRED' });
  expect(planRows(f)).toHaveLength(1); expect(receipts(f)).toHaveLength(1); expect(f.rows.has('family_members/alice')).toBe(false);
});
test('planning_entry_cannot_commit_a_write_interleaved_with_member_removal', async () => {
  const f = setup(); makeAliceMember(f); f.rows.set('meal_plans/' + planId, record());
  f.beforeCommit(event => { if (writesPlan(event)) f.rows.delete('family_members/alice'); });
  expect(await f.entry.update.call(f.context, update)).toEqual({ errCode: 'FAMILY_REQUIRED' });
  expect(f.rows.get('meal_plans/' + planId)).toEqual(record()); expect(receipts(f)).toEqual([]);
  expect(f.rows.has('family_members/alice')).toBe(false);
});
test('planning_entry_never_silently_overwrites_an_interleaved_commit_with_unknown_vendor_conflict', async () => {
  const f = setup(); f.rows.set('meal_plans/' + planId, record()); let interleaved = false; let winner: unknown;
  f.beforeCommit(async event => {
    if (!writesPlan(event) || interleaved) return;
    interleaved = true;
    winner = await f.entry.update.call(f.context, { ...update, meal: 'breakfast', requestId: 'cloud-plan-winner-01' });
  });
  expect(await f.entry.update.call(f.context, { ...update, meal: 'lunch' })).toEqual({ errCode: 'UNAVAILABLE' });
  expect(winner).toMatchObject({ errCode: 0, data: { version: 2, meal: 'breakfast' } });
  expect(f.rows.get('meal_plans/' + planId)).toMatchObject({ version: 2, meal: 'breakfast' });
  expect(receipts(f).map(row => row.requestId)).toEqual(['cloud-plan-winner-01']);
  expect(f.rows.get('family_members/alice')).toMatchObject({ mutationSeq: 1 });
  expect(await f.entry.update.call(f.context, { ...update, meal: 'lunch' })).toEqual({ errCode: 'CONFLICT' });
});
test.each(['add', 'update', 'remove'] as const)('planning_%s_recovers_lost_commit_ack_only_from_atomic_receipt', async method => {
  const f = setup(); if (method !== 'add') f.rows.set('meal_plans/' + planId, record()); let writes = 0;
  f.afterCommit(event => { if (writesPlan(event)) { writes++; throw new Error('Fixture lost acknowledgement: private details'); } });
  const result = await f.entry[method].call(f.context, inputs[method]);
  expect(result).toMatchObject({ errCode: 0, data: method === 'remove' ? null : { version: method === 'add' ? 1 : 2 } });
  expect(writes).toBe(1); expect(receipts(f)).toHaveLength(1);
  expect(await f.entry[method].call(f.context, inputs[method])).toMatchObject({ errCode: 0 }); expect(writes).toBe(1);
});
test('planning_entry_unknown_commit_without_receipt_is_unavailable_without_blind_resubmission', async () => {
  const f = setup(); let writes = 0;
  f.beforeCommit(event => { if (writesPlan(event)) { writes++; throw new Error('Fixture unknown commit: private details'); } });
  expect(await f.entry.add.call(f.context, add)).toEqual({ errCode: 'UNAVAILABLE' });
  expect(writes).toBe(1); expect(planRows(f)).toEqual([]); expect(receipts(f)).toEqual([]);
  f.beforeCommit(() => {});
  expect(await f.entry.add.call(f.context, add)).toMatchObject({ errCode: 0, data: { version: 1 } });
  expect(planRows(f)).toHaveLength(1); expect(receipts(f)).toHaveLength(1);
});
