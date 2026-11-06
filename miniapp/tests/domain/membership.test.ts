import { expect, test } from 'vitest';
import { guardMutation, requireFamily } from '../../uniCloud-alipay/cloudfunctions/common/home-family/membership';
import { familyFixture } from '../support/family-fixtures';

test('guard_mutation_fences_current_member_and_returns_narrow_context', async () => {
  const { h, memberView } = await familyFixture();
  const context = await requireFamily(h.database, { uid: 'member' });
  expect(context).toEqual({ uid: 'member', familyId: 'home', role: 'member', generation: 'member-generation' });
  await h.database.transaction(tx => guardMutation(tx, context));
  expect(await h.rows('family_members')).toEqual(expect.arrayContaining([expect.objectContaining({ _id: 'member', mutationSeq: 1 })]));
  expect(await h.family('member').current()).toEqual(memberView);
});

test('old_generation_cannot_fence_a_rejoined_member', async () => {
  const { h, memberRecord: member, memberView } = await familyFixture();
  h.memory.seed('family_members', 'member', { ...member, generation: 'new-generation', mutationSeq: 7 });
  await expect(h.database.transaction(tx => guardMutation(tx, memberView))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await h.rows('family_members')).toEqual(expect.arrayContaining([expect.objectContaining({ _id: 'member', generation: 'new-generation', mutationSeq: 7 })]));
});

test('family_and_role_mismatch_cannot_mutate_current_membership', async () => {
  const { h, memberView } = await familyFixture();
  await expect(h.database.transaction(tx => guardMutation(tx, { ...memberView, familyId: 'other' }))).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(h.database.transaction(tx => guardMutation(tx, { ...memberView, role: 'owner' }))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await h.rows('family_members')).toEqual(expect.arrayContaining([expect.objectContaining({ _id: 'member', mutationSeq: 0 })]));
});

test('concurrent_removal_aborts_old_mutation_fence', async () => {
  const { h, memberView } = await familyFixture();
  const barrier = h.memory.barrierNextCommit();
  const pending = h.database.transaction(tx => guardMutation(tx, memberView));
  await barrier.reached;
  await h.database.transaction(tx => tx.remove('family_members', 'member'));
  barrier.release();
  await expect(pending).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect(await h.rows('family_members')).toEqual([expect.objectContaining({ _id: 'owner', mutationSeq: 0 })]);
});

test('require_family_refuses_unaffiliated_identity', async () => {
  const { h } = await familyFixture();
  await expect(requireFamily(h.database, { uid: 'outsider' })).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
});
