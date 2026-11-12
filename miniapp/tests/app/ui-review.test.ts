import { afterEach, expect, test, vi } from 'vitest';
import { createProductionClient, reviewRecipes } from '../../review/app-client';

afterEach(() => { vi.unstubAllGlobals(); });
test('isolated_review_client_filters_and_keeps_mutations_local_to_its_instance', async () => {
  vi.stubGlobal('uni', { getStorageSync: () => ({}) });
  const first = createProductionClient(); const second = createProductionClient();
  const family = (await first.family.current())!; const id = reviewRecipes[0].id;
  await first.recipes.favorite({ ...family, requestId: 'ui-review-test-request', id, enabled: true });
  expect((await first.recipes.list({ favoritesOnly: true })).items).toHaveLength(1);
  expect((await second.recipes.list({ favoritesOnly: true })).items).toHaveLength(0);
  expect((await first.recipes.list({ query: '鲜虾', tag: '家常' })).items.map(row => row.id)).toContain(id);
});
test('review_failure_scenarios_return_real_error_codes_without_transport', async () => {
  let scenario = { family: 'failure' };
  vi.stubGlobal('uni', { getStorageSync: () => scenario }); const client = createProductionClient();
  await expect(client.family.current()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  scenario = { family: 'forbidden' };
  await expect(client.recipes.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
