import { expect, test } from 'vitest';
import type { FamilyContext, PlanAdd, PlanEntry, PlanRemove, PlanUpdate, RecipeInput } from 'home-contracts';
import { createHarness } from '../support/harness';
import { createPlanningService } from 'home-planning';
import type { PlanningDeps, PlanningReads, PlanRecord } from 'home-planning';
import { AppError, DatabaseFault } from 'home-kernel';
import type { CollectionName, DatabasePort, TransactionPort } from '../../uniCloud-alipay/cloudfunctions/common/home-kernel/database';
import { deferCall } from '../support/sdk-transport';
import type { RecipeRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes/repository';

type Fixture = Awaited<ReturnType<typeof setup>>;
function candidates(rows: PlanRecord[]) { return rows.map(({ _id, familyId, date, createdAt }) => ({ _id, familyId, date, createdAt })); }
function api(f: Fixture, overrides: Partial<PlanningDeps> = {}, ctx = f.joined) {
  const reads: PlanningReads = { async list(familyId, from, to, limit, after) {
    return candidates((await f.h.rows<PlanRecord>('meal_plans')).filter(p => p.familyId === familyId && p.date >= from && p.date <= to
      && (!after || p.date > after.date || (p.date === after.date && (p.createdAt > after.createdAt || (p.createdAt === after.createdAt && p._id > after.id)))))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a._id.localeCompare(b._id)).slice(0, limit + 1));
  } };
  return createPlanningService({ database: f.h.database, reads, now: () => f.h.now, newId: () => (++sequence).toString(16).padStart(32, 'd'),
    async revalidateIdentity() { await f.h.client(ctx.uid).account.session(); }, ...overrides }, ctx);
}
function trace(f: Fixture, hook: (writes: Set<CollectionName>) => Promise<void> = async () => {}, readHook: (collection: CollectionName) => void = () => {}) {
  const writes = new Set<CollectionName>(); const reads = new Set<CollectionName>(); let mutations = 0;
  const database: DatabasePort = { async transaction(fn) {
    return f.h.database.transaction(async tx => {
      const local = new Set<CollectionName>();
      const wrapped: TransactionPort = {
        async get<T>(collection: CollectionName, id: string) { reads.add(collection); readHook(collection); return tx.get<T>(collection, id); },
        async insert(collection, id, value) { writes.add(collection); local.add(collection); await tx.insert(collection, id, value); },
        async replace(collection, id, value) { writes.add(collection); local.add(collection); await tx.replace(collection, id, value); },
        async remove(collection, id) { writes.add(collection); local.add(collection); await tx.remove(collection, id); },
      };
      const result = await fn(wrapped); if (local.has('meal_plans')) mutations++;
      await hook(local); return result;
    });
  } };
  return { database, writes, reads, get mutations() { return mutations; } };
}
let sequence = 0;
const requestId = () => 'planning-request-' + String(++sequence).padStart(6, '0');
const fields = { date: '2026-12-31', meal: 'dinner' as const, targetServings: null };
const range = { from: '2026-12-31', to: '2027-01-01' };
const recipeInput = (): RecipeInput => ({ title: '盐焗鸡', description: null, baseServings: 4, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['蒸熟。'], tags: [] });
async function setup() {
  const h = createHarness();
  for (const uid of ['owner', 'member', 'outsider', 'alone']) await h.seedIdentity({ uid });
  const owner = h.client('owner'); const member = h.client('member'); const outsider = h.client('outsider');
  const view = await owner.family.create({ requestId: requestId(), name: '我家' });
  const invite = await owner.family.invite({ requestId: requestId() });
  const joined = await member.family.join({ requestId: requestId(), token: invite.token });
  const other = await outsider.family.create({ requestId: requestId(), name: '另一家' });
  const recipe = await owner.recipes.create({ requestId: requestId(), familyId: view.familyId, generation: view.generation, recipe: recipeInput() });
  const input = (actor: Pick<FamilyContext, 'familyId' | 'generation'> = view): PlanAdd => ({ requestId: requestId(), familyId: actor.familyId, generation: actor.generation, recipeId: recipe.id, ...fields });
  const edit = (entry: PlanEntry, actor: Pick<FamilyContext, 'familyId' | 'generation'> = view): PlanUpdate => ({ requestId: requestId(), familyId: actor.familyId, generation: actor.generation, id: entry.id, version: entry.version, ...fields });
  const remove = (entry: PlanEntry, actor: Pick<FamilyContext, 'familyId' | 'generation'> = view): PlanRemove => ({ requestId: requestId(), familyId: actor.familyId, generation: actor.generation, id: entry.id, version: entry.version });
  return { h, owner, member, outsider, view, joined, other, recipe, input, edit, remove };
}

test('same meal accepts independent entries; server owns snapshot and author, both members maintain them', async () => {
  const f = await setup(); const first = await f.owner.planning.add(f.input());
  const second = await f.member.planning.add({ ...f.input(f.joined), targetServings: 2.5 });
  expect(first).toEqual({ ...fields, id: expect.stringMatching(/^[a-f0-9]{32}$/), familyId: f.view.familyId, createdBy: 'owner', recipeId: f.recipe.id,
    titleSnapshot: '盐焗鸡', version: 1, createdAt: f.h.now, updatedAt: f.h.now, sourceAvailable: true, coverImageId: null });
  expect(second).toMatchObject({ createdBy: 'member', targetServings: 2.5 }); expect(second.id).not.toBe(first.id);
  await f.member.planning.update({ ...f.edit(first, f.joined), date: '2027-01-01', meal: 'lunch', targetServings: 0.5 });
  await f.owner.planning.update({ ...f.edit(second), meal: 'breakfast', targetServings: 10000 });
  expect((await f.owner.planning.list(range)).items.map(p => [p.id, p.date, p.meal, p.targetServings])).toEqual([
    [second.id, '2026-12-31', 'breakfast', 10000], [first.id, '2027-01-01', 'lunch', 0.5],
  ]);
  const stored = await f.h.rows<Record<string, unknown>>('meal_plans');
  for (const row of stored) { expect(row).not.toHaveProperty('id'); expect(row).not.toHaveProperty('sourceAvailable'); expect(row).not.toHaveProperty('coverImageId'); }
  await f.member.planning.remove(f.remove({ ...first, version: 2 }, f.joined)); await f.owner.planning.remove(f.remove({ ...second, version: 2 }));
  expect(await f.h.rows('meal_plans')).toEqual([]);
});

test('source changes never rewrite snapshot/target; cover is derived, foreign or missing sources remain editable', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  await f.owner.recipes.update({ requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, id: f.recipe.id, version: 1,
    recipe: { ...recipeInput(), title: '新菜名', baseServings: 8 } });
  const [source] = await f.h.rows<RecipeRecord>('recipes');
  f.h.memory.seed('recipes', source._id, { ...source, imageIds: ['a'.repeat(32), 'b'.repeat(32)] });
  expect(await f.member.planning.get(entry.id)).toMatchObject({ titleSnapshot: '盐焗鸡', targetServings: null, sourceAvailable: true, coverImageId: 'a'.repeat(32) });
  f.h.memory.seed('recipes', source._id, { ...source, familyId: f.other.familyId, imageIds: ['b'.repeat(32)] });
  expect(await f.owner.planning.get(entry.id)).toMatchObject({ sourceAvailable: false, coverImageId: null, titleSnapshot: '盐焗鸡' });
  await f.h.database.transaction(tx => tx.remove('recipes', source._id));
  const updated = await f.member.planning.update({ ...f.edit(entry, f.joined), targetServings: 1.25 });
  expect(updated).toMatchObject({ recipeId: entry.recipeId, createdBy: 'owner', titleSnapshot: '盐焗鸡', sourceAvailable: false, version: 2 });
  await f.owner.planning.remove(f.remove(updated)); expect(await f.h.rows('meal_plans')).toEqual([]);
});

test('invalid stored source is UNAVAILABLE, never represented as deleted', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input()); const [source] = await f.h.rows<RecipeRecord>('recipes');
  f.h.memory.seed('recipes', source._id, { ...source, title: null });
  await expect(f.owner.planning.get(entry.id)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(f.owner.planning.list(range)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(f.owner.planning.update(f.edit(entry))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect((await f.h.rows<{ version: number }>('meal_plans'))[0].version).toBe(1);
  await f.owner.planning.remove(f.remove(entry));
});

test('outsiders and missing ids are indistinguishable; no-family callers cannot access any method', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  for (const id of [entry.id, 'f'.repeat(32)]) {
    await expect(f.outsider.planning.get(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.outsider.planning.update({ ...f.edit(entry, f.other), id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.outsider.planning.remove({ ...f.remove(entry, f.other), id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
  for (const recipeId of [f.recipe.id, 'f'.repeat(32)]) await expect(f.outsider.planning.add({ ...f.input(f.other), recipeId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await f.outsider.planning.list(range)).toEqual({ items: [], nextCursor: null });
  const alone = (f.h.client('alone')).planning;
  for (const call of [() => alone.add(f.input()), () => alone.get(entry.id), () => alone.list(range), () => alone.update(f.edit(entry)), () => alone.remove(f.remove(entry))]) {
    await expect(call()).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  }
  expect(await f.h.rows('meal_plans')).toHaveLength(1);
});

test('IDs must be exactly 32 lowercase hex characters, including rejection of a trailing newline', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  await expect(f.owner.planning.get(entry.id + '\n')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(f.owner.planning.add({ ...f.input(), recipeId: f.recipe.id + '\n' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('requestId rejects trailing newline rather than accepting a different receipt key', async () => {
  const f = await setup(); const input = f.input();
  await expect(f.owner.planning.add({ ...input, requestId: input.requestId + '\n' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('meal_plans')).toEqual([]);
});

test.each(['uid', 'createdBy', 'titleSnapshot', 'title', 'version', 'id', 'sourceAvailable', 'coverImageId', 'createdAt', 'updatedAt', 'extra'])('add rejects untrusted field %s', async key => {
  const f = await setup(); await expect(f.owner.planning.add({ ...f.input(), [key]: 'forged' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('meal_plans')).toEqual([]);
});
test.each([{ recipeId: 'A'.repeat(32) }, { recipeId: 'x' }, { requestId: 'short' }, { date: '2026-02-29' }, { meal: 'snack' },
  { targetServings: 0 }, { targetServings: -1 }, { targetServings: '2' }, { targetServings: Infinity }, { targetServings: NaN }, { targetServings: 10001 }])('add rejects invalid input %#', async patch => {
  const f = await setup(); await expect(f.owner.planning.add({ ...f.input(), ...patch } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test.each([null, [], {}, { date: '2026-12-31' }])('mutations reject incomplete objects %#', async input => {
  const f = await setup();
  for (const call of [f.owner.planning.add, f.owner.planning.update, f.owner.planning.remove]) await expect(call(input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('update/remove enforce exact fields, ids and safe versions; family/generation mismatches conflict', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  for (const patch of [{ recipeId: entry.recipeId }, { createdBy: 'member' }, { titleSnapshot: 'forged' }, { id: 'X'.repeat(32) },
    { version: 0 }, { version: 1.5 }, { version: '1' }, { version: Number.MAX_SAFE_INTEGER }, { version: Infinity }]) {
    await expect(f.owner.planning.update({ ...f.edit(entry), ...patch } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  for (const patch of [{ date: fields.date }, { uid: 'member' }, { id: '' }, { version: -1 }, { version: Number.MAX_SAFE_INTEGER }]) {
    await expect(f.owner.planning.remove({ ...f.remove(entry), ...patch } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  for (const patch of [{ familyId: f.other.familyId }, { generation: 'stale-generation' }]) {
    await expect(f.owner.planning.add({ ...f.input(), ...patch })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.owner.planning.update({ ...f.edit(entry), ...patch })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(f.owner.planning.remove({ ...f.remove(entry), ...patch })).rejects.toMatchObject({ code: 'CONFLICT' });
  }
  for (const id of ['', 'A'.repeat(32), 'a'.repeat(33), null]) await expect(f.owner.planning.get(id as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect((await f.owner.planning.get(entry.id)).version).toBe(1);
});

test('all receipts replay historical acknowledgments even after deletion, and bind normalized payloads', async () => {
  const f = await setup(); const add = f.input(); const first = await f.owner.planning.add(add);
  const edit = { ...f.edit(first), targetServings: 2.5 }; const updated = await f.owner.planning.update(edit);
  const remove = f.remove(updated); await f.owner.planning.remove(remove);
  const shuffled = Object.fromEntries(Object.entries(add).reverse()) as PlanAdd;
  expect(await f.owner.planning.add(shuffled)).toEqual(first); expect(await f.owner.planning.update(edit)).toEqual(updated);
  await expect(f.owner.planning.remove(remove)).resolves.toBeUndefined();
  await expect(f.owner.planning.add({ ...add, targetServings: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.owner.planning.update({ ...edit, meal: 'other' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.owner.planning.remove({ ...remove, version: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await f.h.rows('meal_plans')).toEqual([]);
  const receipts = (await f.h.rows<{ _id: string; operation: string; result: unknown }>('mutation_receipts')).filter(r => r.operation.startsWith('plan-'));
  expect(receipts.map(r => r.operation).sort()).toEqual(['plan-add-v1', 'plan-remove-v1', 'plan-update-v1']);
  expect(receipts.find(r => r.operation === 'plan-remove-v1')!.result).toEqual({ done: true });
});

test('concurrent repeat add requests create only one row', async () => {
  const f = await setup(); const input = f.input(); const results = await Promise.all([f.owner.planning.add(input), f.owner.planning.add(input)]);
  expect(results[0]).toEqual(results[1]); expect(await f.h.rows('meal_plans')).toHaveLength(1);
});
test('different entries edited concurrently never overwrite each other', async () => {
  const f = await setup(); const a = await f.owner.planning.add(f.input()); const b = await f.owner.planning.add(f.input());
  await Promise.all([f.owner.planning.update({ ...f.edit(a), targetServings: 2 }), f.member.planning.update({ ...f.edit(b, f.joined), targetServings: 3 })]);
  expect((await f.owner.planning.list(range)).items.map(p => [p.id, p.version, p.targetServings])).toEqual([[a.id, 2, 2], [b.id, 2, 3]]);
});
test('same-version concurrent updates have exactly one winner', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  const results = await Promise.allSettled([f.owner.planning.update({ ...f.edit(entry), targetServings: 2 }), f.member.planning.update({ ...f.edit(entry, f.joined), targetServings: 3 })]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
  expect((await f.owner.planning.get(entry.id)).version).toBe(2);
});

test('departed authors retain shared plans, but old generation delivery/replay is denied after rejoin', async () => {
  const f = await setup(); const add = f.input(f.joined); const entry = await f.member.planning.add(add);
  const edit = f.edit(entry, f.joined); const updated = await f.member.planning.update(edit);
  const otherEntry = await f.member.planning.add(f.input(f.joined)); const remove = f.remove(otherEntry, f.joined); await f.member.planning.remove(remove);
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  expect(await f.owner.planning.get(entry.id)).toMatchObject({ createdBy: 'member', version: 2 });
  await expect(f.member.planning.add(add)).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  const invite = await f.owner.family.invite({ requestId: requestId() }); await f.member.family.join({ requestId: requestId(), token: invite.token });
  for (const request of [add, { ...add, requestId: requestId() }]) await expect(f.member.planning.add(request)).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.member.planning.update(edit)).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.member.planning.remove(remove)).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.owner.planning.remove(f.remove(updated)); expect(await f.h.rows('meal_plans')).toEqual([]);
});

test('paging includes entry 21 and equal timestamps, scoped by date/family and ordered by date then id', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  const [base] = await f.h.rows<Record<string, unknown>>('meal_plans'); await f.h.database.transaction(tx => tx.remove('meal_plans', entry.id));
  for (let i = 1; i <= 25; i++) { const id = (1000 + i).toString(16).padStart(32, '0'); f.h.memory.seed('meal_plans', id, { ...base, _id: id, date: i <= 23 ? '2026-12-31' : '2027-01-01' }); }
  f.h.memory.seed('meal_plans', 'e'.repeat(32), { ...base, _id: 'e'.repeat(32), date: '2027-01-02' });
  f.h.memory.seed('meal_plans', 'f'.repeat(32), { ...base, _id: 'f'.repeat(32), familyId: f.other.familyId });
  const first = await f.owner.planning.list(range); expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeTypeOf('string');
  const second = await f.owner.planning.list({ ...range, cursor: first.nextCursor! }); expect(second.items).toHaveLength(5); expect(second.nextCursor).toBeNull();
  expect([...first.items, ...second.items].map(p => p.id)).toEqual(Array.from({ length: 25 }, (_, i) => (1001 + i).toString(16).padStart(32, '0')));
});
test.each([
  { from: '2026-12-01', to: '2026-12-31' }, { from: '2026-12-15', to: '2027-01-14' }, { from: '0004-02-01', to: '0004-03-02' },
  { from: '0099-12-15', to: '0100-01-14' }, { from: '0001-01-01', to: '0001-01-01' }, { from: '9999-12-01', to: '9999-12-31' },
])('accepts inclusive 1..31 calendar-day range %#', async input => {
  const f = await setup(); expect(await f.owner.planning.list(input)).toEqual({ items: [], nextCursor: null });
});
test.each([
  { from: '2026-12-01', to: '2027-01-01' }, { from: '0004-02-01', to: '0004-03-03' }, { from: '2026-12-31', to: '2026-12-30' },
  { from: '0000-01-01' }, { to: '2026-02-29' }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: '2' }, { limit: null }, { familyId: 'forged' },
])('rejects invalid date range/limit/list fields %#', async patch => {
  const f = await setup(); await expect(f.owner.planning.list({ ...range, ...patch } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('cursor binds user, family, generation and date range', async () => {
  const f = await setup(); for (let i = 0; i < 2; i++) await f.owner.planning.add(f.input());
  const first = await f.member.planning.list({ ...range, limit: 1 }); const cursor = first.nextCursor!;
  for (const api of [f.owner.planning, f.outsider.planning]) await expect(api.list({ ...range, cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(f.member.planning.list({ from: '2026-12-30', to: range.to, cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(f.member.planning.list({ ...range, to: '2027-01-02', cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  const invite = await f.owner.family.invite({ requestId: requestId() }); await f.member.family.join({ requestId: requestId(), token: invite.token });
  await expect(f.member.planning.list({ ...range, cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test.each(['', 'a'.repeat(513), '%%%', 'e30', Buffer.from('[]').toString('base64url'), Buffer.from('{broken').toString('base64url')])('rejects malformed cursor %#', async cursor => {
  const f = await setup(); await expect(f.owner.planning.list({ ...range, cursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('read and write limits persist across planning service instances, separately per operation', async () => {
  const f = await setup(); let entry!: PlanEntry;
  for (let i = 0; i < 10; i++) entry = await (f.h.client('owner')).planning.add(f.input());
  await expect(f.owner.planning.add(f.input())).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  await f.owner.planning.update(f.edit(entry));
  for (let i = 0; i < 60; i++) await (f.h.client('owner')).planning.get(entry.id);
  await expect(f.owner.planning.get(entry.id)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect((await f.owner.planning.list(range)).items).toHaveLength(10);
  f.h.advance(60000); await f.owner.planning.add(f.input()); expect(await f.h.rows('meal_plans')).toHaveLength(11);
});

test('only member fence, plans, receipts and limits are written; recipes are read only', async () => {
  const f = await setup(); const observed = trace(f); const service = api(f, { database: observed.database });
  const entry = await service.add(f.input(f.joined)); const updated = await service.update(f.edit(entry, f.joined)); await service.remove(f.remove(updated, f.joined));
  expect([...observed.writes].sort()).toEqual(['family_members', 'meal_plans', 'mutation_receipts', 'request_limits']);
  expect(observed.reads.has('recipes')).toBe(true); expect(await f.h.rows('meal_plans')).toEqual([]);
});

test.each(['add', 'update', 'remove'] as const)('precommit failure rolls back %s and its receipt/member fence', async operation => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input()); const before = await f.h.rows('meal_plans'); const members = await f.h.rows('family_members');
  const receipts = await f.h.rows('mutation_receipts'); let armed = true;
  const observed = trace(f, async writes => { if (armed && writes.has('meal_plans')) { armed = false; f.h.memory.failNext('commit'); } });
  const service = api(f, { database: observed.database });
  const action = () => operation === 'add' ? service.add(f.input(f.joined)) : operation === 'update' ? service.update(f.edit(entry, f.joined)) : service.remove(f.remove(entry, f.joined));
  await expect(action()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await f.h.rows('meal_plans')).toEqual(before); expect(await f.h.rows('mutation_receipts')).toEqual(receipts); expect(await f.h.rows('family_members')).toEqual(members);
});

test.each(['add', 'update', 'remove'] as const)('lost committed ack recovers %s once without replaying writes', async operation => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input()); let armed = true; let identityChecks = 0;
  const observed = trace(f, async writes => { if (armed && writes.has('meal_plans')) { armed = false; f.h.memory.failNext('after-commit'); } });
  const service = api(f, { database: observed.database, async revalidateIdentity() { identityChecks++; await f.member.account.session(); } });
  const add = f.input(f.joined); const edit = f.edit(entry, f.joined); const remove = f.remove(entry, f.joined);
  const action = () => operation === 'add' ? service.add(add) : operation === 'update' ? service.update(edit) : service.remove(remove);
  const result = await action(); expect(identityChecks).toBeGreaterThanOrEqual(3); expect(observed.mutations).toBe(1);
  expect(await action()).toEqual(result); expect(observed.mutations).toBe(1);
  const rows = await f.h.rows<PlanRecord>('meal_plans');
  expect(rows).toHaveLength(operation === 'add' ? 2 : operation === 'remove' ? 0 : 1);
  if (operation === 'update') expect(rows[0].version).toBe(2);
});

test('unknown commit without receipt returns UNAVAILABLE and never blindly retries', async () => {
  const f = await setup(); const observed = trace(f, async writes => { if (writes.has('meal_plans')) throw new DatabaseFault('commit-unknown'); });
  await expect(api(f, { database: observed.database }).add(f.input(f.joined))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(observed.mutations).toBe(1); expect(await f.h.rows('meal_plans')).toEqual([]);
  expect((await f.h.rows<{ operation: string }>('mutation_receipts')).filter(r => r.operation.startsWith('plan-'))).toEqual([]);
});
test('known conflicts retry three times then map to CONFLICT only in planning', async () => {
  const f = await setup(); const observed = trace(f, async writes => { if (writes.has('meal_plans')) throw new DatabaseFault('conflict'); });
  await expect(api(f, { database: observed.database }).add(f.input(f.joined))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(observed.mutations).toBe(3); expect(await f.h.rows('meal_plans')).toEqual([]);
});
test.each([new AppError('AUTH_REQUIRED'), new AppError('FORBIDDEN'), new Error('source store failed')])('only NOT_FOUND is suppressed when resolving source %#', async error => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input());
  const observed = trace(f, undefined, collection => { if (collection === 'recipes') throw error; });
  await expect(api(f, { database: observed.database }).get(entry.id)).rejects.toMatchObject({ code: error instanceof AppError ? error.code : 'UNAVAILABLE' });
});

test('update versus remove CAS race rejects stale deletion after update commits', async () => {
  const f = await setup(); const entry = await f.owner.planning.add(f.input()); const ready = deferCall(); let barrier: ReturnType<typeof f.h.memory.barrierNextCommit>;
  const service = api(f, { async revalidateIdentity() { await f.member.account.session(); if (!barrier) { barrier = f.h.memory.barrierNextCommit(); ready.resolve(null); } } });
  const pending = service.remove(f.remove(entry, f.joined)); const settled = Promise.allSettled([pending]); await ready.promise; await barrier!.reached;
  await f.owner.planning.update({ ...f.edit(entry), targetServings: 2 }); barrier!.release();
  expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
  expect(await f.owner.planning.get(entry.id)).toMatchObject({ version: 2, targetServings: 2 });
});

test.each(['leave', 'remove'] as const)('membership %s fences an already-staged write', async operation => {
  const f = await setup(); const ready = deferCall(); let barrier: ReturnType<typeof f.h.memory.barrierNextCommit>;
  const service = api(f, { async revalidateIdentity() { await f.member.account.session(); if (!barrier) { barrier = f.h.memory.barrierNextCommit(); ready.resolve(null); } } });
  const pending = service.add(f.input(f.joined)); const settled = Promise.allSettled([pending]); await ready.promise; await barrier!.reached;
  if (operation === 'leave') await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  else await f.owner.family.removeMember({ requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, uid: 'member', targetGeneration: f.joined.generation });
  barrier!.release(); expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { code: 'FAMILY_REQUIRED' } }); expect(await f.h.rows('meal_plans')).toEqual([]);
});

test.each(['add', 'list', 'get', 'update', 'remove', 'replay'] as const)('membership is checked before returning %s result', async operation => {
  const f = await setup(); const add = f.input(f.joined); const entry = await f.member.planning.add(add); let removed = false;
  const observed = trace(f, async writes => {
    if (!removed && writes.has('meal_plans')) { removed = true; }
  });
  const service = api(f, { database: observed.database, async revalidateIdentity() {
    const shouldLeave = ['list', 'get', 'replay'].includes(operation) || removed;
    if (shouldLeave && (await f.member.family.current())) await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
    await f.member.account.session();
  } });
  const action = () => operation === 'add' ? service.add(f.input(f.joined)) : operation === 'list' ? service.list(range) : operation === 'get' ? service.get(entry.id)
    : operation === 'update' ? service.update(f.edit(entry, f.joined)) : operation === 'remove' ? service.remove(f.remove(entry, f.joined)) : service.add(add);
  await expect(action()).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
});

test.each(['before-write', 'return', 'recovery'] as const)('token revocation at %s prevents result disclosure', async stage => {
  const f = await setup(); let checks = 0;
  const observed = trace(f, async writes => { if (stage === 'recovery' && writes.has('meal_plans')) f.h.memory.failNext('after-commit'); });
  const service = api(f, { database: observed.database, async revalidateIdentity() {
    checks++; if (checks === (stage === 'before-write' ? 1 : 2)) f.h.revokeToken('member'); await f.member.account.session();
  } });
  await expect(service.add(f.input(f.joined))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(await f.h.rows('meal_plans')).toHaveLength(stage === 'before-write' ? 0 : 1);
});

test('list hydrates current records, skips moved/deleted/foreign rows and advances by candidates even on empty page', async () => {
  const f = await setup(); const entries: PlanEntry[] = [];
  for (let i = 0; i < 4; i++) entries.push(await f.owner.planning.add(f.input()));
  const rows = await f.h.rows<PlanRecord>('meal_plans'); let queried = false;
  const reads: PlanningReads = { async list(familyId, from, to, limit, after) {
    expect([familyId, from, to, limit]).toEqual([f.joined.familyId, range.from, range.to, 2]);
    if (after) { expect(after).toMatchObject({ date: fields.date, createdAt: f.h.now, id: entries[1].id }); return candidates(rows.slice(2)); }
    queried = true;
    await f.h.database.transaction(async tx => {
      await tx.remove('meal_plans', entries[0].id); await tx.replace('meal_plans', entries[1].id, { ...rows[1], date: '2027-01-02' });
      await tx.replace('meal_plans', entries[2].id, { ...rows[2], familyId: f.other.familyId });
      await tx.replace('meal_plans', entries[3].id, { ...rows[3], date: '2027-01-01', version: 2, targetServings: 3 });
    });
    return candidates(rows.slice(0, 3));
  } };
  const service = api(f, { reads }); const first = await service.list({ ...range, limit: 2 });
  expect(queried).toBe(true); expect(first.items).toEqual([]); expect(first.nextCursor).toBeTypeOf('string');
  const second = await service.list({ ...range, limit: 2, cursor: first.nextCursor! });
  expect(second.items).toMatchObject([{ id: entries[3].id, date: '2027-01-01', version: 2, targetServings: 3 }]); expect(second.nextCursor).toBeNull();
});

test.each(['family', 'range', 'order', 'size', 'duplicate', 'invalid-date', 'invalid-time'] as const)('query candidates reject invalid %s', async kind => {
  const f = await setup(); for (let i = 0; i < 3; i++) await f.owner.planning.add(f.input());
  const rows = candidates(await f.h.rows<PlanRecord>('meal_plans'));
  if (kind === 'family') rows[0].familyId = f.other.familyId;
  if (kind === 'range') rows[0].date = '2027-01-02';
  if (kind === 'order') rows.reverse();
  if (kind === 'duplicate') rows[1] = rows[0];
  if (kind === 'invalid-date') rows[0].date = '2026-02-29';
  if (kind === 'invalid-time') rows[0].createdAt = -1;
  await expect(api(f, { reads: { async list() { return rows; } } }).list({ ...range, limit: kind === 'size' ? 1 : 2 })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('candidate must advance beyond supplied cursor and cursor tuple must have strict shape', async () => {
  const f = await setup(); for (let i = 0; i < 2; i++) await f.owner.planning.add(f.input());
  const first = await f.member.planning.list({ ...range, limit: 1 }); const cursor = first.nextCursor!;
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  for (const patch of [{ extra: 1 }, { id: 'A'.repeat(32) }, { createdAt: 1.5 }, { date: '2026-02-29' }, { date: '2026-12-30' }, { scope: 'wrong' }]) {
    await expect(f.member.planning.list({ ...range, cursor: Buffer.from(JSON.stringify({ ...value, ...patch })).toString('base64url') })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  await expect(api(f, { reads: { async list() { return candidates(await f.h.rows<PlanRecord>('meal_plans')); } } }).list({ ...range, limit: 1, cursor })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('membership lost while query is pending cannot disclose candidate rows', async () => {
  const f = await setup(); await f.owner.planning.add(f.input()); const entered = deferCall(); const gate = deferCall();
  const service = api(f, { reads: { async list() { entered.resolve(null); await gate.promise; return candidates(await f.h.rows<PlanRecord>('meal_plans')); } } });
  const pending = service.list(range); const settled = Promise.allSettled([pending]); await entered.promise;
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation }); gate.resolve(null);
  expect((await settled)[0]).toMatchObject({ status: 'rejected', reason: { code: 'FAMILY_REQUIRED' } });
});
