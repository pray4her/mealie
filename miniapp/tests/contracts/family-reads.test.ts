import { expect, test } from 'vitest';
import { createFamilyReads } from 'home-family';
import type { FamilyReadPlatform } from 'home-family';

test('family_query_adapter_keeps_scope_cursor_sort_limit_and_nickname_projection', async () => {
  const calls: unknown[] = [];
  const platform: FamilyReadPlatform = {
    command: { lt: value => ({ lt: value }), gt: value => ({ gt: value }), in: values => ({ in: values }), or: values => ({ or: values }), and: values => ({ and: values }) },
    collection(name) {
      calls.push(['collection', name]);
      const query = {
        where(value: unknown) { calls.push(['where', value]); return query; }, orderBy(field: string, direction: string) { calls.push(['orderBy', field, direction]); return query; },
        limit(value: number) { calls.push(['limit', value]); return query; }, field(value: unknown) { calls.push(['field', value]); return query; },
        async get() { return { data: name === 'uni-id-users' ? [{ _id: 'bob', nickname: '家人', token: ['must not escape'] }] : [] }; },
      }; return query;
    },
  };
  const reads = createFamilyReads(platform);
  await reads.invitations('trusted-family', { familyId: 'trusted-family', createdAt: 123, id: 'abc' });
  expect(calls).toEqual([
    ['collection', 'family_invitations'], ['where', { and: [{ familyId: 'trusted-family' }, { or: [{ createdAt: { lt: 123 } }, { createdAt: 123, _id: { lt: 'abc' } }] }] }],
    ['orderBy', 'createdAt', 'desc'], ['orderBy', '_id', 'desc'], ['limit', 21],
  ]);
  calls.length = 0; await reads.members('trusted-family', 'alice');
  expect(calls).toEqual([['collection', 'family_members'], ['where', { familyId: 'trusted-family', _id: { gt: 'alice' } }], ['orderBy', '_id', 'asc'], ['limit', 100]]);
  calls.length = 0; expect(await reads.nicknames(['bob'])).toEqual({ bob: '家人' });
  expect(calls).toEqual([['collection', 'uni-id-users'], ['where', { _id: { in: ['bob'] } }], ['field', { _id: true, nickname: true }], ['limit', 100]]);
});
