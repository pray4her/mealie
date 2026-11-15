import { afterEach, expect, test, vi } from 'vitest';
import { createProductionClient, reviewRecipes } from '../../review/app-client';

// These test the isolated visual fixture, not cloud/domain correctness.
afterEach(() => vi.unstubAllGlobals());
const date = '2026-12-31';
async function fixture(planning: Record<string, string> = {}) {
  const scenario: { planning: Record<string, string> } = { planning: { date, ...planning } };
  vi.stubGlobal('uni', { getStorageSync: () => scenario });
  const client = createProductionClient(); const family = (await client.family.current())!;
  const fields = { familyId: family.familyId, generation: family.generation, date, meal: 'dinner' as const, targetServings: null, requestId: 'review-planning-request' };
  const input = { ...fields, recipeId: reviewRecipes[0].id };
  const list = () => client.planning.list({ from: date, to: date, limit: 20 });
  return { client, scenario, input, fields, list };
}
test('review planning seeds bounded unique fixture rows and opaque continuation', async () => {
  const f = await fixture({ seed: 'pagination' }); const first = await f.list();
  expect(first.items).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
  const next = await f.client.planning.list({ from: date, to: date, limit: 20, cursor: first.nextCursor! });
  expect(next.items).toHaveLength(1); expect(next.nextCursor).toBeNull();
  expect(new Set([...first.items, ...next.items].map(row => row.id)).size).toBe(21);
  expect(first.items.every(row => /^[a-f0-9]{32}$/.test(row.id))).toBe(true);
  await expect(f.client.planning.list({ from: '2027-01-01', to: '2027-01-01', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('review planning read failure can recover without replacing stored plans', async () => {
  const f = await fixture({ seed: 'populated', read: 'failure' });
  await expect(f.list()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  delete f.scenario.planning.read; const rows = (await f.list()).items; expect(rows).toHaveLength(4);
  f.scenario.planning.read = 'failure'; await expect(f.client.planning.get(rows[0].id)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('review write failure commits nothing and identical retry can succeed', async () => {
  const f = await fixture({ write: 'failure' });
  await expect(f.client.planning.add(f.input)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect((await f.list()).items).toEqual([]);
  delete f.scenario.planning.write; await f.client.planning.add(f.input); expect((await f.list()).items).toHaveLength(1);
});
test('review lost acknowledgement commits once and replay checks the original payload', async () => {
  const f = await fixture({ write: 'lost-ack' });
  await expect(f.client.planning.add(f.input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const committed = (await f.list()).items[0]; expect(committed).toBeDefined();
  expect(await f.client.planning.add(f.input)).toEqual(committed); expect((await f.list()).items).toHaveLength(1);
  await expect(f.client.planning.add({ ...f.input, targetServings: 3 })).rejects.toMatchObject({ code: 'CONFLICT' });
});
test('review conflict simulates a competing version once, allowing explicit reload then save', async () => {
  const f = await fixture({ seed: 'populated', write: 'conflict' }); const row = (await f.list()).items[0];
  const input = { ...f.fields, id: row.id, version: row.version, targetServings: 4 };
  await expect(f.client.planning.update(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  const latest = await f.client.planning.get(row.id); expect(latest).toMatchObject({ version: 2, targetServings: 3.5 });
  await expect(f.client.planning.update(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await f.client.planning.update({ ...input, version: latest.version, requestId: 'review-reloaded-request' })).toMatchObject({ version: 3, targetServings: 4 });
});
test('review unavailable source retains a long editable snapshot without a cover', async () => {
  const f = await fixture({ seed: 'long', source: 'unavailable' }); const row = (await f.list()).items[0];
  expect(row.titleSnapshot.length).toBeGreaterThan(50); expect(row).toMatchObject({ sourceAvailable: false, coverImageId: null });
  await expect(f.client.recipes.get(row.recipeId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await f.client.planning.update({ ...f.fields, id: row.id, version: row.version, targetServings: .5 })).toMatchObject({ sourceAvailable: false, targetServings: .5, titleSnapshot: row.titleSnapshot });
});
test('review empty seed stays isolated from another populated client', async () => {
  const populated = await fixture({ seed: 'populated' }); expect((await populated.list()).items).toHaveLength(4);
  const empty = await fixture({ seed: 'empty' }); expect((await empty.list()).items).toEqual([]);
});
