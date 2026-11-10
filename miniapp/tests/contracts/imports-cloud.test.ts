import { expect, test } from 'vitest';
import { cloudFixture } from '../support/cloud-platform';

test('imports_public_object_is_lazy_authenticated_and_has_only_three_methods', async () => {
  const f = cloudFixture('imports-co');
  expect(Object.keys(f.entry).sort()).toEqual(['cancel', 'get', 'submit']); expect(f.transactions).toBe(0); expect(f.sdkImports).toBe(0);
  expect(await f.entry.submit.call({ ...f.context, getUniIdToken: () => 'forged' }, {})).toEqual({ errCode: 'AUTH_REQUIRED' });
  expect(f.transactions).toBe(0);
  const now = Date.now();
  f.rows.set('families/home', { _id: 'home', name: '家', ownerUid: 'alice', status: 'active', version: 1, createdAt: now, updatedAt: now });
  f.rows.set('family_members/alice', { _id: 'alice', familyId: 'home', generation: 'generation', role: 'owner', mutationSeq: 0, joinedAt: now, updatedAt: now });
  const input = { requestId: 'cloud-imports-submit-01', familyId: 'home', generation: 'generation', source: { kind: 'text', text: '盐汤，加盐煮水' } };
  expect(await f.entry.submit.call(f.context, input, 'extra')).toEqual({ errCode: 'INVALID_INPUT' });
  const result = await f.entry.submit.call(f.context, input) as { data: { id: string } };
  expect(result).toMatchObject({ errCode: 0, data: { state: 'queued', attempts: 0, recipeId: null } });
  expect(await f.entry.get.call(f.context, result.data.id)).toMatchObject({ errCode: 0, data: { id: result.data.id } });
  expect(await f.entry.cancel.call(f.context, { requestId: 'cloud-imports-cancel-01', familyId: 'home', generation: 'generation', id: result.data.id })).toMatchObject({ data: { state: 'cancelled' } });
});
