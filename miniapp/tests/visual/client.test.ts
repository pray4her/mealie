import { expect, test } from 'vitest';
import { createVisualClient, fixtureIds } from './client';

test('visual fixture runs the login/create/recipe/import flow entirely in memory', async () => {
  const client = createVisualClient('login');
  await expect(client.account.session()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  await client.account.signInWeixin();
  expect(await client.family.current()).toBeNull();
  const family = await client.family.create({ requestId: 'visual-create-0001', name: '视觉验证家庭' });
  expect(family.name).toBe('视觉验证家庭');
  const result = await client.recipes.list({ query: '家常' });
  expect(result.items.length).toBeGreaterThan(0);
  await client.recipes.favorite({ ...family, requestId: 'visual-favorite-01', id: fixtureIds.recipe, enabled: true });
  expect((await client.recipes.list({ favoritesOnly: true })).items).toHaveLength(1);
  const job = await client.imports.submit({ ...family, requestId: 'visual-import-001', source: { kind: 'text', text: '仅测试文本' } });
  expect(job.state).toBe('queued');
  expect((await client.imports.cancel({ ...family, requestId: 'visual-cancel-001', id: job.id })).state).toBe('cancelled');
});

test('fixture scenario exposes existing recipe unknown fields and terminal task states', async () => {
  const client = createVisualClient('succeeded');
  const recipe = await client.recipes.get(fixtureIds.recipe);
  expect(recipe.ingredients.some(row => row.quantity === null && row.raw.length > 0)).toBe(true);
  expect((await client.imports.get(fixtureIds.job)).recipeId).toBe(recipe.id);
  expect((await createVisualClient('onboarding').family.current())).toBeNull();
});
