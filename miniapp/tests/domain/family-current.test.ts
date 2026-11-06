import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';
import { familyFixture } from '../support/family-fixtures';

test('current_returns_null_for_authenticated_user_without_membership', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  expect(await h.family('alice').current()).toBeNull();
});

test('current_reads_cloud_family_and_callers_current_role', async () => {
  const { h, ownerView, memberView } = await familyFixture();
  expect(await h.family('owner').current()).toEqual(ownerView);
  expect(await h.family('member').current()).toEqual(memberView);
  expect(await h.family('outsider').current()).toBeNull();
});

test('each_family_call_checks_current_identity_without_trusting_uid', async () => {
  const h = createHarness();
  await expect(h.family('forged').current()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  await expect(h.family('forged').create({ requestId: 'request-00000001', name: '我家' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(await h.rows('request_limits')).toEqual([]);
  await h.seedIdentity({ uid: 'alice' }); const api = h.family('alice');
  expect(await api.current()).toBeNull(); h.revokeToken('alice');
  await expect(api.current()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
});

test.each(['missing-family', 'inactive-family', 'missing-owner', 'owner-other-family', 'owner-wrong-role', 'caller-wrong-role', 'malformed-role', 'malformed-member', 'extra-family-field'])('broken_relationship_%s_is_not_treated_as_no_family', async kind => {
  const { h, family, ownerRecord: owner, memberRecord: member } = await familyFixture();
  if (kind === 'missing-family') await h.database.transaction(tx => tx.remove('families', 'home'));
  if (kind === 'inactive-family') h.memory.seed('families', 'home', { ...family, status: 'dissolved' });
  if (kind === 'missing-owner') await h.database.transaction(tx => tx.remove('family_members', 'owner'));
  if (kind === 'owner-other-family') h.memory.seed('family_members', 'owner', { ...owner, familyId: 'other' });
  if (kind === 'owner-wrong-role') h.memory.seed('family_members', 'owner', { ...owner, role: 'member' });
  if (kind === 'caller-wrong-role') h.memory.seed('family_members', 'member', { ...member, role: 'owner' });
  if (kind === 'malformed-role') h.memory.seed('family_members', 'member', { ...member, role: ['member'] });
  if (kind === 'malformed-member') h.memory.seed('family_members', 'member', { ...member, mutationSeq: -1 });
  if (kind === 'extra-family-field') h.memory.seed('families', 'home', { ...family, secret: 'must-not-return' });
  await expect(h.family('member').current()).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  await expect(h.family('member').create({ requestId: 'request-00000001', name: '另一家' })).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect(await h.rows('families')).toHaveLength(kind === 'missing-family' ? 0 : 1);
  expect(await h.rows('mutation_receipts')).toEqual([]);
});
