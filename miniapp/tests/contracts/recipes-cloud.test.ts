import { expect, test } from 'vitest';
import type { Recipe } from 'home-contracts';
import { cloudFixture } from '../support/cloud-platform';
import { createRecipeReads } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes/repository';
import type { RecipeReadPlatform } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes/repository';
const recipe = () => ({ title: '汤', description: '说明', baseServings: null, prepMinutes: 0, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: ['家常'] });
function setup() {
  const f = cloudFixture('recipes-co', 'void'); const now = Date.now();
  f.rows.set('families/home', { _id: 'home', name: '家', ownerUid: 'alice', status: 'active', version: 1, createdAt: now, updatedAt: now });
  f.rows.set('family_members/alice', { _id: 'alice', familyId: 'home', generation: 'generation', role: 'owner', mutationSeq: 0, joinedAt: now, updatedAt: now });
  return f;
}
test('recipe_object_has_only_six_lazy_methods_and_uses_trusted_openid_scene3', async () => {
  const f = setup(); expect(Object.keys(f.entry).sort()).toEqual(['bindImages', 'create', 'favorite', 'get', 'list', 'update']); expect(f.sdkImports).toBe(0); expect(f.transactions).toBe(0);
  const input = { requestId: 'cloud-recipe-create-01', familyId: 'home', generation: 'generation', recipe: recipe() };
  const created = await f.entry.create.call(f.context, input) as { data: Recipe };
  expect(created).toMatchObject({ errCode: 0, data: { createdBy: 'alice', familyId: 'home', version: 1, ingredients: [{ raw: '盐适量', quantity: null }] }, newToken: { token: 'renewed-token' } });
  expect(f.contentCalls).toEqual([{ content: '汤\n说明\n盐适量\n盐\n煮\n家常', openid: 'server-openid', scene: 3, version: 2 }]);
  expect(await f.entry.get.call(f.context, created.data.id)).toMatchObject({ errCode: 0, data: created.data });
  expect(await f.entry.update.call(f.context, { ...input, requestId: 'cloud-recipe-update-01', id: created.data.id, version: 1, recipe: { ...recipe(), title: '新标题' } })).toMatchObject({ errCode: 0, data: { version: 2, createdBy: 'alice' } });
  expect(await f.entry.create.call(f.context, input, 'extra')).toEqual({ errCode: 'INVALID_INPUT' });
  const mark = { requestId: 'cloud-recipe-favorite-01', familyId: 'home', generation: 'generation', id: created.data.id, enabled: true };
  expect(await f.entry.favorite.call(f.context, mark)).toMatchObject({ errCode: 0, data: null });
  expect(await f.entry.favorite.call(f.context, mark)).toMatchObject({ errCode: 0, data: null });
  expect(await f.entry.get.call(f.context, created.data.id)).toMatchObject({ data: { isFavorite: true } });
  expect(await f.entry.favorite.call(f.context, mark, 'extra')).toEqual({ errCode: 'INVALID_INPUT' });
});
test('forged_platform_or_token_is_rejected_before_database_and_audit', async () => {
  const f = setup();
  for (const context of [{ ...f.context, getUniIdToken: () => 'forged' }, { ...f.context, getClientInfo: () => ({ appId: 'forged', uniPlatform: 'mp-weixin' }) }]) {
    expect(await f.entry.create.call(context, {})).toEqual({ errCode: 'AUTH_REQUIRED' });
  }
  expect(f.transactions).toBe(0); expect(f.contentCalls).toHaveLength(0);
});
test('revocation_during_real_audit_and_malformed_check_response_do_not_write', async () => {
  for (const revoke of [false, true]) {
    const f = setup();
    if (revoke) f.afterContent(() => f.revoke()); else f.setContent({ errCode: 0, result: { suggest: 'pass' } });
    expect(await f.entry.create.call(f.context, { requestId: 'cloud-recipe-create-01', familyId: 'home', generation: 'generation', recipe: recipe() })).toMatchObject({ errCode: revoke ? 'AUTH_REQUIRED' : 'UNAVAILABLE' });
    expect([...f.rows.keys()].filter(key => key.startsWith('recipes/'))).toHaveLength(0);
  }
});
test('recipe_query_adapter_applies_family_sort_and_bounded_limit_before_fetch', async () => {
  const calls: unknown[] = [];
  const query = { where(value: unknown) { calls.push(['where', value]); return this; }, orderBy(...args: unknown[]) { calls.push(['orderBy', ...args]); return this; },
    field(value: unknown) { calls.push(['field', value]); return this; },
    limit(value: unknown) { calls.push(['limit', value]); return this; }, async get() { return { data: [] }; } };
  const platform = { collection(name: string) { calls.push(['collection', name]); return query; }, command: {
    lt: (value: unknown) => ({ lt: value }), in: (value: unknown) => ({ in: value }), and: (value: unknown) => ({ and: value }), or: (value: unknown) => ({ or: value }),
  } } as RecipeReadPlatform;
  const reads = createRecipeReads(platform);
  expect(await reads.list('home', 2, { familyId: 'home', createdAt: 7, id: 'a'.repeat(32) })).toEqual([]);
  expect(calls).toEqual([['collection', 'recipes'], ['where', { and: [{ familyId: 'home' }, { or: [{ createdAt: { lt: 7 } }, { createdAt: 7, _id: { lt: 'a'.repeat(32) } }] }] }],
    ['field', { _id: true, familyId: true, title: true, tags: true, createdAt: true }],
    ['orderBy', 'createdAt', 'desc'], ['orderBy', '_id', 'desc'], ['limit', 3]]);
});
