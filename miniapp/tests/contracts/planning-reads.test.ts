import { expect, test } from 'vitest';
import { createPlanningReads } from 'home-planning';
import type { PlanningReadPlatform } from 'home-planning';

function fixture(result: unknown = { data: [] }) {
  const calls: unknown[] = [];
  const query = {
    where(value: unknown) { calls.push(['where', value]); return this; },
    field(value: unknown) { calls.push(['field', value]); return this; },
    orderBy(...args: unknown[]) { calls.push(['orderBy', ...args]); return this; },
    limit(value: unknown) { calls.push(['limit', value]); return this; },
    async get() { calls.push(['get']); return result; },
  };
  const platform: PlanningReadPlatform = {
    collection(name) { calls.push(['collection', name]); return query; },
    command: { gt: value => ({ gt: value }), gte: value => ({ gte: value }), lte: value => ({ lte: value }),
      and: value => ({ and: value }), or: value => ({ or: value }) },
  };
  return { calls, reads: createPlanningReads(platform) };
}
const projection = ['field', { _id: true, familyId: true, date: true, createdAt: true }];
const ordering = [['orderBy', 'date', 'asc'], ['orderBy', 'createdAt', 'asc'], ['orderBy', '_id', 'asc']];
test('planning_query_pushes_family_inclusive_dates_projection_sort_and_limit_plus_one_to_sdk', async () => {
  const f = fixture();
  expect(await f.reads.list('home', '2026-11-01', '2026-11-30', 20)).toEqual([]);
  expect(f.calls).toEqual([['collection', 'meal_plans'], ['where', { and: [
    { familyId: 'home' }, { date: { gte: '2026-11-01' } }, { date: { lte: '2026-11-30' } },
  ] }], projection, ...ordering, ['limit', 21], ['get']]);
});
test('planning_keyset_query_includes_all_three_strict_tie_breakers_inside_family_and_range', async () => {
  const f = fixture();
  await f.reads.list('home', '2026-11-01', '2026-11-30', 2, { date: '2026-11-15', createdAt: 7, id: 'a'.repeat(32) });
  expect(f.calls).toEqual([['collection', 'meal_plans'], ['where', { and: [
    { familyId: 'home' }, { date: { gte: '2026-11-01' } }, { date: { lte: '2026-11-30' } },
    { or: [{ date: { gt: '2026-11-15' } }, { date: '2026-11-15', createdAt: { gt: 7 } },
      { date: '2026-11-15', createdAt: 7, _id: { gt: 'a'.repeat(32) } }] },
  ] }], projection, ...ordering, ['limit', 3], ['get']]);
});
test('planning_query_accepts_ordinary_data_arrays_not_transaction_point_read_shapes', async () => {
  const row = { _id: 'a'.repeat(32), familyId: 'home', date: '2026-11-15', createdAt: 7 };
  const f = fixture({ errCode: 0, data: [row] });
  expect(await f.reads.list('home', '2026-11-15', '2026-11-15', 1)).toEqual([row]);
});
test.each([null, false, [], {}, { data: null }, { data: {} }, { data: 'rows' }, { data: undefined },
  { errCode: 'FAILED', data: [] }, { errCode: 1, data: [] }])('planning_query_rejects_malformed_sdk_envelope_%j', async result => {
  await expect(fixture(result).reads.list('home', '2026-11-15', '2026-11-15', 1)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
