import { expect, test, vi } from 'vitest';
import type { PlanAdd, PlanEntry, PlanListInput, PlanRemove, PlanUpdate } from 'home-contracts';
import { createPlanningApi } from '../../src/features/planning/api';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createCloudClient } from '../../src/shared/cloud-client';
import { AppError } from '../../src/shared/errors';
import { createMemoryStorage } from '../support/sdk-transport';
import { createHarness } from '../support/harness';

const id = 'a'.repeat(32); const recipeId = 'b'.repeat(32);
const fields = { date: '2026-12-31', meal: 'dinner' as const, targetServings: null };
const mutation = { ...fields, requestId: 'planning-request-01', familyId: 'home', generation: 'gen', recipeId };
const entry: PlanEntry = { ...fields, id, recipeId, familyId: 'home', createdBy: 'alice', titleSnapshot: '汤', version: 1,
  createdAt: 1, updatedAt: 1, sourceAvailable: true, coverImageId: null };
const boundary = () => createSessionBoundary(createMemoryStorage());
const responding = (value: unknown) => createPlanningApi({ boundary: boundary(), invoke: async <T>() => value as T });

test('five production methods roundtrip real domain and null remove transport', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const family = await client.family.create({ requestId: 'planning-family-01', name: '家' });
  const scope = { familyId: family.familyId, generation: family.generation };
  const recipe = await client.recipes.create({ ...scope, requestId: 'planning-recipe-01', recipe: { title: '汤', description: null,
    baseServings: null, prepMinutes: null, cookMinutes: null, ingredients: [{ raw: '盐', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] } });
  const session = boundary(); const cloud = createCloudClient({ boundary: session, async transport(object, method, input) {
    expect(object).toBe('planning-co');
    const data = method === 'add' ? await client.planning.add(input as PlanAdd) : method === 'update' ? await client.planning.update(input as PlanUpdate)
      : method === 'get' ? await client.planning.get(input as string) : method === 'list' ? await client.planning.list(input as PlanListInput)
        : method === 'remove' ? (await client.planning.remove(input as PlanRemove), null) : (() => { throw new Error('Unexpected method'); })();
    return { errCode: 0, data };
  } });
  const api = createPlanningApi({ boundary: session, invoke: cloud.invoke });
  const row = await api.add({ ...mutation, ...scope, recipeId: recipe.id });
  expect(await api.get(row.id)).toEqual(row);
  expect((await api.list({ from: fields.date, to: fields.date })).items).toEqual([row]);
  const updated = await api.update({ ...fields, ...scope, id: row.id, version: 1, requestId: 'planning-update-01', targetServings: 2.5 });
  expect(updated).toMatchObject({ version: 2, targetServings: 2.5, titleSnapshot: '汤' });
  await api.remove({ ...scope, id: row.id, version: 2, requestId: 'planning-remove-01' });
  await expect(api.get(row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

test.each([{ date: '2026-02-29' }, { meal: 'snack' }, { targetServings: 0 }, { targetServings: Infinity }, { targetServings: 10001 },
  { targetServings: '2' }, { recipeId: 'not-id' }, { requestId: 'short' }, { familyId: ' home' }, { generation: '\u0000' }, { titleSnapshot: 'forged' }])('invalid add never sends %#', async patch => {
  const invoke = vi.fn(); const api = createPlanningApi({ boundary: boundary(), invoke });
  await expect(api.add({ ...mutation, ...patch } as PlanAdd)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(invoke).not.toHaveBeenCalled();
});
test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity])('invalid CAS versions never send %s', async version => {
  const invoke = vi.fn(); const api = createPlanningApi({ boundary: boundary(), invoke });
  const input = { requestId: mutation.requestId, familyId: 'home', generation: 'gen', id, version };
  await expect(api.update({ ...input, ...fields })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(api.remove(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(invoke).not.toHaveBeenCalled();
});
test.each([{ from: '2026-01-01', to: '2026-02-01' }, { from: '2026-01-02', to: '2026-01-01' }, { limit: 21 }, { limit: 0 }, { limit: null },
  { cursor: '' }, { cursor: 'x'.repeat(513) }, { familyId: 'other' }])('invalid list never sends %#', async patch => {
  const invoke = vi.fn(); const api = createPlanningApi({ boundary: boundary(), invoke });
  await expect(api.list({ from: fields.date, to: fields.date, ...patch } as PlanListInput)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(invoke).not.toHaveBeenCalled();
});
test.each([null, {}, { ...entry, unexpected: true }, { ...entry, date: '2026-02-29' }, { ...entry, meal: null }, { ...entry, targetServings: 0 },
  { ...entry, id: 'x' }, { ...entry, recipeId: 'x' }, { ...entry, version: 0 }, { ...entry, updatedAt: -1 }, { ...entry, createdAt: 1.5 },
  { ...entry, updatedAt: Number.MAX_SAFE_INTEGER + 1 }, { ...entry, createdAt: 2 }, { ...entry, titleSnapshot: ' ' }, { ...entry, createdBy: '' },
  { ...entry, coverImageId: 'https://secret' }, { ...entry, sourceAvailable: 'yes' }, { ...entry, sourceAvailable: false, coverImageId: id }])('malformed entries never render %#', async value => {
  await expect(responding(value).get(id)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('mutations check family and resource but permit historic receipt versions', async () => {
  await expect(responding({ ...entry, familyId: 'other' }).add(mutation)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(responding({ ...entry, recipeId: id }).add(mutation)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(responding({ ...entry, id: recipeId }).get(id)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const update = { ...fields, id, version: 9, familyId: 'home', generation: 'gen', requestId: mutation.requestId };
  await expect(responding({ ...entry, id: recipeId }).update(update)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await responding(entry).update(update)).toEqual(entry);
  expect(await responding({ ...entry, sourceAvailable: false }).get(id)).toMatchObject({ sourceAvailable: false, titleSnapshot: '汤' });
});
test.each([{}, { items: [], nextCursor: undefined }, { items: [], nextCursor: '!' }, { items: Array(21).fill(entry), nextCursor: null },
  { items: [entry, { ...entry, familyId: 'other' }], nextCursor: null }, { items: [{ ...entry, date: '2027-01-01' }], nextCursor: null }])('invalid page never normalizes %#', async value => {
  await expect(responding(value).list({ from: fields.date, to: fields.date })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test.each([undefined, {}, true, entry])('remove requires null %#', async value => {
  await expect(responding(value).remove({ id, version: 1, familyId: 'home', generation: 'gen', requestId: mutation.requestId })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('AUTH_REQUIRED closes shared boundary and removes credentials', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'secret'); const session = createSessionBoundary(storage);
  const api = createPlanningApi({ boundary: session, invoke: async () => { throw new AppError('AUTH_REQUIRED'); } });
  await expect(api.get(id)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' }); expect(storage.get('uni_id_token')).toBeUndefined();
  await expect(session.run('business', async () => null)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
});
