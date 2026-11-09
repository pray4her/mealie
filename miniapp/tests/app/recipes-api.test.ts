import { expect, test, vi } from 'vitest';
import { createHarness } from '../support/harness';
import { createMemoryStorage } from '../support/sdk-transport';
import { createRecipesApi } from '../../src/features/recipes/api';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createCloudClient } from '../../src/shared/cloud-client';
import { AppError } from '../../src/shared/errors';
import { parseInput } from '../../src/features/recipes/validation';

const input = () => ({ title: '汤', description: null, baseServings: null, prepMinutes: null, cookMinutes: 0,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] });
test('production_recipe_api_roundtrips_through_the_same_cloud_envelope_and_domain', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const view = await client.family.create({ requestId: 'recipe-api-family-01', name: '家' });
  const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, async transport(object, method, value) {
    expect(object).toBe('recipes-co');
    if (method === 'create') return { errCode: 0, data: await client.recipes.create(value as Parameters<typeof client.recipes.create>[0]) };
    if (method === 'get') return { errCode: 0, data: await client.recipes.get(value as string) };
    if (method === 'list') return { errCode: 0, data: await client.recipes.list(value as Parameters<typeof client.recipes.list>[0]) };
    if (method === 'favorite') { await client.recipes.favorite(value as Parameters<typeof client.recipes.favorite>[0]); return { errCode: 0, data: null }; }
    throw new Error('Unexpected method');
  } });
  const api = createRecipesApi({ boundary, invoke: cloud.invoke });
  const created = await api.create({ requestId: 'recipe-api-create-01', familyId: view.familyId, generation: view.generation, recipe: input() });
  expect(await api.get(created.id)).toEqual(created); expect((await api.list({})).items[0].ingredients[0].quantity).toBeNull();
  await api.favorite({ requestId: 'recipe-api-favorite-01', familyId: view.familyId, generation: view.generation, id: created.id, enabled: true });
  expect((await api.list({ query: ' 汤 ', favoritesOnly: true })).items).toMatchObject([{ id: created.id, isFavorite: true }]);
});
test.each([{}, { title: '' }, { quantity: 0 }, { quantity: '2' }])('malformed_editable_payload_never_reaches_transport_%#', async patch => {
  const boundary = createSessionBoundary(createMemoryStorage()); const invoke = vi.fn(async () => { throw new Error('Unexpected transport call'); });
  const api = createRecipesApi({ boundary, invoke });
  const recipe = input(); if ('quantity' in patch) Object.assign(recipe.ingredients[0], patch); else Object.assign(recipe, patch, { createdBy: 'forged' });
  await expect(api.create({ requestId: 'recipe-api-create-01', familyId: 'home', generation: 'gen', recipe })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(invoke).not.toHaveBeenCalled();
});
test.each([null, {}, { id: 'forged' }, { items: [], nextCursor: 'x'.repeat(513) }, { items: [], nextCursor: null, uid: 'forged' }])('malformed_cloud_response_is_not_renderable_%#', async value => {
  const boundary = createSessionBoundary(createMemoryStorage()); const api = createRecipesApi({ boundary, invoke: async <T>() => value as T });
  await expect(api.get('a'.repeat(32))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  if (value && 'items' in value) await expect(api.list({})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('business_auth_failure_closes_the_shared_sdk_boundary_and_erases_tokens', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'secret-fixture');
  const boundary = createSessionBoundary(storage); const api = createRecipesApi({ boundary, invoke: async () => { throw new AppError('AUTH_REQUIRED'); } });
  await expect(api.get('a'.repeat(32))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(storage.get('uni_id_token')).toBeUndefined();
  await expect(boundary.run('business', async () => null)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
});
test('client_utf8_boundary_counts_multibyte_text_and_preserves_nullable_quantities', () => {
  expect(parseInput(input()).ingredients[0].quantity).toBeNull();
  expect(() => parseInput({ ...input(), steps: Array.from({ length: 6 }, () => '字'.repeat(2000)) })).toThrow();
});

test.each([{ query: '字'.repeat(121) }, { tag: '\u0000' }, { query: '\uD800' }, { favoritesOnly: 1 }, { uid: 'other' }, { limit: null }])('invalid_search_never_reaches_transport_%#', async input => {
  const invoke = vi.fn(); const api = createRecipesApi({ boundary: createSessionBoundary(createMemoryStorage()), invoke });
  await expect(api.list(input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(invoke).not.toHaveBeenCalled();
});

test('favorite_requires_a_valid_null_confirmation', async () => {
  const api = createRecipesApi({ boundary: createSessionBoundary(createMemoryStorage()), invoke: async <T>() => ({ done: true }) as T });
  await expect(api.favorite({ requestId: 'recipe-api-favorite-01', familyId: 'home', generation: 'gen', id: 'a'.repeat(32), enabled: true })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test('non_ascii_query_at_unicode_limit_is_not_expanded_between_validation_layers', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const view = await client.family.create({ requestId: 'unicode-family-01', name: '家' });
  await client.recipes.create({ requestId: 'unicode-recipe-01', familyId: view.familyId, generation: view.generation, recipe: { ...input(), title: 'İ'.repeat(120) } });
  const api = createRecipesApi({ boundary: createSessionBoundary(createMemoryStorage()), invoke: async <T>(_object: string, method: string, value: unknown) => {
    if (method !== 'list') throw new Error('Unexpected method'); return await client.recipes.list(value as never) as T;
  } });
  const { parseListInput } = await import('../../src/features/recipes/validation');
  expect((await api.list(parseListInput({ query: 'İ'.repeat(120) }))).items).toHaveLength(1);
});
