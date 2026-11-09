import { expect, test, vi } from 'vitest';
import { createHarness } from '../support/harness';
import { DatabaseFault } from 'home-kernel';
import { invitedFamilyFixture } from '../support/family-fixtures';

async function fixture() {
  const h = createHarness();
  for (const uid of ['owner', 'bob', 'carol', 'outsider']) await h.seedIdentity({ uid });
  const owner = h.client('owner'); const bob = h.client('bob'); const carol = h.client('carol');
  const family = await owner.family.create({ requestId: 'create-owner-00001', name: '我家' });
  return { h, owner, bob, carol, family };
}
const request = (name: string) => ({ requestId: `request-${name.padEnd(16, '_')}` });

test('invitation_fixture_gives_two_people_the_same_family_and_keeps_outsider_separate', async () => {
  const { owner, member, outsider, familyId } = await invitedFamilyFixture();
  expect((await owner.family.current())?.familyId).toBe(familyId); expect((await member.family.current())?.familyId).toBe(familyId); expect(await outsider.family.current()).toBeNull();
});

test('invite_is_24_hours_and_replay_returns_the_same_capability_without_storing_it', async () => {
  const { h, owner } = await fixture();
  const logs = vi.spyOn(console, 'log');
  try {
    const invite = await owner.family.invite(request('invite'));
    expect(invite.expiresAt).toBe(1_800_086_400_000);
    expect(await owner.family.invite(request('invite'))).toEqual(invite);
    const stored = JSON.stringify(await Promise.all(['family_invitations', 'mutation_receipts', 'request_limits', 'family_members', 'families'].map(name => h.rows(name))));
    expect(stored).not.toContain(invite.token);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(invite.token);
    expect(await h.rows('family_invitations')).toHaveLength(1);
  } finally { logs.mockRestore(); }
});

test('join_replay_survives_expiry_but_new_consumption_does_not', async () => {
  const { h, owner, bob, carol } = await fixture();
  const used = await owner.family.invite(request('used'));
  const expires = await owner.family.invite(request('expires'));
  const input = { ...request('join'), token: used.token };
  const joined = await bob.family.join(input);
  expect(joined.role).toBe('member');
  h.advance(86_400_000);
  // Renew trusted test identities without bypassing the actual family implementation.
  await h.seedIdentity({ uid: 'bob' }); await h.seedIdentity({ uid: 'carol' });
  expect(await bob.family.join(input)).toEqual(joined);
  await expect(carol.family.join({ ...request('expired'), token: expires.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
});

test('two_users_racing_for_one_invitation_create_only_one_new_member', async () => {
  const { h, owner, bob, carol } = await fixture();
  const invite = await owner.family.invite(request('invite'));
  const results = await Promise.allSettled([bob.family.join({ ...request('bob'), token: invite.token }), carol.family.join({ ...request('carol'), token: invite.token })]);
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(2);
  expect((await h.rows<{ status: string }>('family_invitations'))[0].status).toBe('used');
});

test('ordinary_member_cannot_manage_invitations_and_existing_member_does_not_consume', async () => {
  const { owner, bob } = await fixture();
  const first = await owner.family.invite(request('first'));
  await bob.family.join({ ...request('join'), token: first.token });
  await expect(bob.family.invite(request('denied'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(bob.family.invitations({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(bob.family.revokeInvite({ ...request('denied'), invitationId: first.invitationId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const second = await owner.family.invite(request('second'));
  await expect(bob.family.join({ ...request('new-join'), token: second.token })).rejects.toMatchObject({ code: 'ALREADY_IN_FAMILY' });
  expect((await owner.family.invitations({})).items.find(item => item.invitationId === second.invitationId)?.status).toBe('pending');
});

test('revoke_is_idempotent_and_cannot_revoke_used_or_other_families_invites', async () => {
  const { owner, bob, h } = await fixture();
  const invite = await owner.family.invite(request('invite'));
  const input = { ...request('revoke'), invitationId: invite.invitationId };
  await owner.family.revokeInvite(input); await owner.family.revokeInvite(input);
  await expect(bob.family.join({ ...request('join'), token: invite.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  await h.client('outsider').family.create({ ...request('outside'), name: '另一家' });
  await expect(h.client('outsider').family.revokeInvite({ ...request('other'), invitationId: invite.invitationId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const used = await owner.family.invite(request('used'));
  await bob.family.join({ ...request('used-join'), token: used.token });
  await expect(owner.family.revokeInvite({ ...request('used-revoke'), invitationId: used.invitationId })).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('same_join_request_with_another_token_conflicts_and_old_generation_cannot_replay', async () => {
  const { h, owner, bob } = await fixture();
  const first = await owner.family.invite(request('first')); const second = await owner.family.invite(request('second'));
  const input = { ...request('join'), token: first.token };
  await bob.family.join(input);
  await expect(bob.family.join({ ...input, token: second.token })).rejects.toMatchObject({ code: 'CONFLICT' });
  const member = (await h.rows<{ _id: string; generation: string }>('family_members')).find(row => row._id === 'bob')!;
  h.memory.seed('family_members', 'bob', { ...member, generation: 'new-generation' });
  await expect(bob.family.join(input)).rejects.toMatchObject({ code: 'CONFLICT' });
});

test.each(['replace:family_invitations', 'insert:family_members', 'replace:families', 'insert:mutation_receipts'] as const)('join_rolls_back_every_write_when_%s_fails', async stage => {
  const { h, owner, bob } = await fixture();
  const invite = await owner.family.invite(request('invite'));
  h.memory.failNext(stage);
  await expect(bob.family.join({ ...request('join'), token: invite.token })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await bob.family.current()).toBeNull();
  expect((await h.rows<{ status: string }>('family_invitations'))[0].status).toBe('pending');
});

test('join_recovers_a_committed_receipt_after_lost_commit_acknowledgement', async () => {
  const { h, owner, bob } = await fixture();
  const invite = await owner.family.invite(request('invite'));
  // Trigger at the business write, after the separate persistent quota transaction.
  const transaction = h.database.transaction; let fired = false;
  h.database.transaction = fn => transaction(async tx => {
    const insert = tx.insert.bind(tx);
    tx.insert = async (collection, id, value) => { await insert(collection, id, value); if (collection === 'family_members' && !fired) { fired = true; h.memory.failNext('after-commit', new DatabaseFault('commit-unknown')); } };
    return fn(tx);
  });
  const joined = await bob.family.join({ ...request('join'), token: invite.token });
  expect(joined.role).toBe('member'); expect(await h.rows('family_members')).toHaveLength(2);
});

test('multiple_invites_remain_independent_and_members_only_expose_safe_names', async () => {
  const { owner, bob, carol } = await fixture();
  const first = await owner.family.invite(request('first')); const second = await owner.family.invite(request('second'));
  await bob.family.join({ ...request('bob'), token: first.token });
  await carol.family.join({ ...request('carol'), token: second.token });
  const members = await bob.family.members();
  expect(members).toHaveLength(3);
  expect(members.every(row => Object.keys(row).sort().join(',') === 'generation,nickname,role,uid')).toBe(true);
  expect(members.every(row => row.nickname === '家庭成员')).toBe(true);
});

test('expiry_is_checked_again_when_a_conflicting_transaction_retries', async () => {
  const { h, owner, bob } = await fixture(); const invite = await owner.family.invite(request('invite'));
  h.advance(86_399_999); await h.seedIdentity({ uid: 'bob' });
  const transaction = h.database.transaction; let crossed = false;
  h.database.transaction = fn => transaction(async tx => {
    const get = tx.get.bind(tx);
    tx.get = async <T>(collection: Parameters<typeof tx.get>[0], id: string): Promise<T | null> => {
      const row = await get<T>(collection, id);
      if (collection === 'family_invitations' && !crossed) { crossed = true; h.advance(1); throw new DatabaseFault('conflict'); }
      return row;
    };
    return fn(tx);
  });
  await expect(bob.family.join({ ...request('join'), token: invite.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  expect(await bob.family.current()).toBeNull();
});

test('create_and_join_race_or_two_different_invites_never_give_a_user_two_families', async () => {
  const { h, owner, bob, carol } = await fixture();
  const a = await owner.family.invite(request('a')); const b = await owner.family.invite(request('b'));
  const joins = await Promise.allSettled([bob.family.join({ ...request('a'), token: a.token }), bob.family.join({ ...request('b'), token: b.token })]);
  expect(joins.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  const c = await owner.family.invite(request('c'));
  const creates = await Promise.allSettled([carol.family.create({ ...request('create'), name: '自己家' }), carol.family.join({ ...request('join'), token: c.token })]);
  expect(creates.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  const members = await h.rows<{ _id: string; role: string }>('family_members');
  expect(members.filter(row => row._id === 'carol')).toHaveLength(1);
  expect(await h.rows('families')).toHaveLength(creates[0].status === 'fulfilled' ? 2 : 1);
});

test('revoke_and_join_race_has_one_winner_and_no_partial_membership', async () => {
  const { h, owner, bob } = await fixture(); const invite = await owner.family.invite(request('invite'));
  const results = await Promise.allSettled([owner.family.revokeInvite({ ...request('revoke'), invitationId: invite.invitationId }), bob.family.join({ ...request('join'), token: invite.token })]);
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  const row = (await h.rows<{ status: string }>('family_invitations'))[0];
  expect(await h.rows('family_members')).toHaveLength(row.status === 'used' ? 2 : 1);
});

test('forged_tokens_and_expired_invite_replay_do_not_create_members', async () => {
  const { h, owner, bob } = await fixture(); const invite = await owner.family.invite(request('invite'));
  const tampered = invite.token.slice(0, -2) + (invite.token.endsWith('AA') ? 'BB' : 'AA');
  await expect(bob.family.join({ ...request('tamper'), token: tampered })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  h.advance(86_400_000); await h.seedIdentity({ uid: 'owner' });
  await expect(owner.family.invite(request('invite'))).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  expect(await h.rows('family_members')).toHaveLength(1);
});

test('owner_tenure_change_never_reactivates_an_old_invite_even_after_return', async () => {
  const { h, owner, bob } = await fixture(); const invite = await owner.family.invite(request('invite'));
  const member = (await h.rows<{ _id: string; generation: string }>('family_members')).find(row => row._id === 'owner')!;
  // Task04 must rotate generation on ownership changes, including return to the same UID.
  h.memory.seed('family_members', 'owner', { ...member, generation: 'returned-owner-tenure' });
  await expect(bob.family.join({ ...request('join'), token: invite.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  await expect(owner.family.invite(request('invite'))).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('missing_keys_do_not_break_current_or_create_and_do_not_write_invitations', async () => {
  const h = createHarness({ invitationEnvironment: () => ({}) }); await h.seedIdentity({ uid: 'owner' });
  const owner = h.client('owner'); expect(await owner.family.current()).toBeNull();
  await owner.family.create({ ...request('create'), name: '家' });
  await expect(owner.family.invite(request('invite'))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await owner.family.current()).not.toBeNull(); expect(await h.rows('family_invitations')).toHaveLength(0);
});

test('invitation_pages_are_stable_at_equal_timestamps_and_members_are_not_truncated', async () => {
  const { h, owner, family } = await fixture();
  for (let i = 0; i < 23; i++) {
    if (i && i % 9 === 0) h.advance(60_000);
    await owner.family.invite(request(`invite-${i}`));
  }
  const first = await owner.family.invitations({}); const second = await owner.family.invitations({ cursor: first.nextCursor });
  expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map(item => item.invitationId)).size).toBe(23);
  const ownerRecord = (await h.rows<{ _id: string }>('family_members'))[0];
  for (let i = 0; i < 103; i++) h.memory.seed('family_members', `extra-${String(i).padStart(3, '0')}`, { ...ownerRecord, _id: `extra-${String(i).padStart(3, '0')}`, role: 'member', generation: `extra-${i}` });
  h.nickname('owner', '家长');
  const members = await owner.family.members(); expect(members).toHaveLength(104);
  expect(members.find(item => item.uid === 'owner')).toEqual({ uid: 'owner', nickname: '家长', role: 'owner', generation: expect.any(String) });
  expect((await owner.family.current())?.familyId).toBe(family.familyId);
  const outside = h.client('outsider'); await outside.family.create({ ...request('other'), name: '外人家' });
  await expect(outside.family.invitations({ cursor: first.nextCursor })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await outside.family.members()).toEqual([{ uid: 'outsider', nickname: '家庭成员', role: 'owner', generation: expect.any(String) }]);
});

test('a_transient_owner_read_conflict_is_retried_instead_of_becoming_invalid_invitation', async () => {
  const { h, owner, bob, family } = await fixture(); const invite = await owner.family.invite(request('invite'));
  const transaction = h.database.transaction; let once = false;
  h.database.transaction = fn => transaction(async tx => {
    const get = tx.get.bind(tx);
    tx.get = async <T>(collection: Parameters<typeof tx.get>[0], id: string): Promise<T | null> => {
      if (!once && collection === 'families' && id === family.familyId) { once = true; throw new DatabaseFault('conflict'); }
      return get<T>(collection, id);
    };
    return fn(tx);
  });
  expect((await bob.family.join({ ...request('join'), token: invite.token })).role).toBe('member');
});
