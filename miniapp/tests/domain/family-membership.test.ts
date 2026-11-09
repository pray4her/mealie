import { expect, test } from 'vitest';
import type { FamilyContext, MemberMutation, MembershipMutation } from 'home-contracts';
import { DatabaseFault } from 'home-kernel';
import { guardMutation } from 'home-family';
import { invitedFamilyFixture } from '../support/family-fixtures';
import type { MemberRecord, FamilyRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-family/model';

type Fixture = Awaited<ReturnType<typeof invitedFamilyFixture>>;
const requestId = (label: string) => `membership-${label.padEnd(16, '_')}`;
const mutation = (ctx: FamilyContext, label = 'request'): MembershipMutation => ({ requestId: requestId(label), familyId: ctx.familyId, generation: ctx.generation });
const target = (ctx: FamilyContext, member: FamilyContext, label = 'request'): MemberMutation => ({ ...mutation(ctx, label), uid: member.uid, targetGeneration: member.generation });
async function fixture() {
  const f = await invitedFamilyFixture();
  return { ...f, ownerCtx: (await f.owner.family.current())!, memberCtx: (await f.member.family.current())! };
}
async function members(f: Fixture) { return f.h.rows<MemberRecord>('family_members'); }
async function family(f: Fixture) { return (await f.h.rows<FamilyRecord>('families'))[0]; }
function holdBusiness(f: Fixture) {
  let release!: () => void; let entered!: () => void; let held = false;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const transaction = f.h.database.transaction;
  f.h.database.transaction = fn => transaction(async tx => {
    let business = false;
    const insert = tx.insert.bind(tx);
    tx.insert = async (collection, id, value) => { if (collection === 'mutation_receipts') business = true; await insert(collection, id, value); };
    const result = await fn(tx);
    if (business && !held) { held = true; entered(); await wait; }
    return result;
  });
  return { reached, release };
}

test('owner_cannot_leave_before_transfer', async () => {
  const f = await fixture();
  await expect(f.owner.family.leave(mutation(f.ownerCtx))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await members(f)).toHaveLength(2); expect((await family(f)).ownerUid).toBe('owner');
});

test('leave_revokes_family_access_without_revoking_login_and_replays_after_absence', async () => {
  const f = await fixture(); const input = mutation(f.memberCtx);
  await f.member.family.leave(input); await f.member.family.leave(input);
  expect(await f.member.account.session()).toMatchObject({ uid: 'member' });
  expect(await f.member.family.current()).toBeNull();
  await expect(f.member.family.members()).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect(await members(f)).toHaveLength(1); expect((await family(f)).version).toBe(3);
});

test('leave_replay_cannot_delete_a_later_membership_or_restore_old_join_authority', async () => {
  const f = await fixture(); const input = mutation(f.memberCtx);
  await f.member.family.leave(input);
  const invite = await f.owner.family.invite({ requestId: requestId('new-invite') });
  const rejoined = await f.member.family.join({ requestId: requestId('rejoin'), token: invite.token });
  expect(rejoined.generation).not.toBe(f.memberCtx.generation);
  await f.member.family.leave(input);
  expect(await f.member.family.current()).toMatchObject(rejoined);
  await expect(f.h.database.transaction(tx => guardMutation(tx, f.memberCtx))).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.member.family.leave(mutation(f.memberCtx, 'stale-first'))).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('owner_removes_only_the_expected_member_and_replay_never_removes_a_rejoined_slot', async () => {
  const f = await fixture(); const input = target(f.ownerCtx, f.memberCtx);
  await f.owner.family.removeMember(input);
  expect(await f.member.family.current()).toBeNull();
  const invite = await f.owner.family.invite({ requestId: requestId('another-invite') });
  const rejoined = await f.member.family.join({ requestId: requestId('rejoin'), token: invite.token });
  await f.owner.family.removeMember(input);
  expect(await f.member.family.current()).toMatchObject(rejoined);
  await expect(f.owner.family.removeMember({ ...input, requestId: requestId('late-first') })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.owner.family.removeMember({ ...input, uid: 'outsider' })).rejects.toMatchObject({ code: 'CONFLICT' });
});

test('target_operations_reject_ordinary_members_self_targets_and_other_families', async () => {
  const f = await fixture();
  await f.outsider.family.create({ requestId: requestId('other-family'), name: '另一家' });
  const outsider = (await f.outsider.family.current())!;
  for (const method of ['removeMember', 'transferOwner'] as const) {
    await expect(f.member.family[method](target(f.memberCtx, f.ownerCtx, method))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.owner.family[method](target(f.ownerCtx, f.ownerCtx, `self-${method}`))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(f.owner.family[method](target(f.ownerCtx, outsider, `other-${method}`))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
});

test('transfer_atomically_changes_both_roles_and_generations_and_replays_for_the_new_member', async () => {
  const f = await fixture(); const input = target(f.ownerCtx, f.memberCtx);
  const result = await f.owner.family.transferOwner(input);
  expect(result).toMatchObject({ uid: 'owner', familyId: f.familyId, role: 'member' });
  expect(result.generation).not.toBe(f.ownerCtx.generation);
  const nextOwner = (await f.member.family.current())!;
  expect(nextOwner.role).toBe('owner'); expect(nextOwner.generation).not.toBe(f.memberCtx.generation);
  expect((await family(f)).ownerUid).toBe('member');
  expect((await members(f)).filter(row => row.role === 'owner')).toHaveLength(1);
  expect(await f.owner.family.transferOwner(input)).toEqual(result);
  await expect(f.member.family.leave(mutation(nextOwner))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.owner.family.leave(mutation(result, 'after-transfer'));
  expect(await f.owner.family.current()).toBeNull();
});

test('owner_aba_cannot_revive_old_invites_receipts_or_a_delayed_first_operation', async () => {
  const f = await fixture();
  const invite = await f.owner.family.invite({ requestId: requestId('old-invite') });
  const input = target(f.ownerCtx, f.memberCtx);
  const previousOwner = await f.owner.family.transferOwner(input);
  const currentOwner = (await f.member.family.current())!;
  await f.member.family.transferOwner(target(currentOwner, previousOwner, 'return-owner'));
  await expect(f.outsider.family.join({ requestId: requestId('old-invite-join'), token: invite.token })).rejects.toMatchObject({ code: 'INVITATION_INVALID' });
  await expect(f.owner.family.transferOwner(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.owner.family.removeMember(target(f.ownerCtx, f.memberCtx, 'late-owner'))).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await members(f)).filter(row => row.role === 'owner')).toHaveLength(1);
});

test.each(['leave', 'removeMember', 'transferOwner'] as const)('%s_rejects_extra_fields_and_missing_or_wrong_expected_context', async method => {
  const f = await fixture(); const api = method === 'leave' ? f.member.family : f.owner.family;
  const input = method === 'leave' ? mutation(f.memberCtx) : target(f.ownerCtx, f.memberCtx);
  await expect(api[method]({ ...input, role: 'owner' } as unknown as MemberMutation)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(api[method]({ requestId: requestId('missing') } as MemberMutation)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(api[method]({ ...input, familyId: 'untrusted' } as MemberMutation)).rejects.toMatchObject({ code: 'CONFLICT' });
});

test.each(['leave', 'removeMember', 'transferOwner'] as const)('%s_rolls_back_members_family_and_receipt_for_every_business_write', async method => {
  for (let failure = 1; failure <= (method === 'transferOwner' ? 6 : 4); failure++) {
    const f = await fixture(); const before = await members(f); const original = await family(f);
    const receipts = await f.h.rows('mutation_receipts');
    const transaction = f.h.database.transaction; let writes = 0;
    f.h.database.transaction = fn => transaction(async tx => {
      const insert = tx.insert.bind(tx); const replace = tx.replace.bind(tx); const remove = tx.remove.bind(tx);
      const fail = (collection: string) => { if (collection !== 'request_limits' && ++writes === failure) throw new DatabaseFault('unavailable'); };
      tx.insert = async (collection, id, value) => { fail(collection); await insert(collection, id, value); };
      tx.replace = async (collection, id, value) => { fail(collection); await replace(collection, id, value); };
      tx.remove = async (collection, id) => { fail(collection); await remove(collection, id); };
      return fn(tx);
    });
    await expect(method === 'leave' ? f.member.family.leave(mutation(f.memberCtx)) : f.owner.family[method](target(f.ownerCtx, f.memberCtx))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await members(f)).toEqual(before); expect(await family(f)).toEqual(original); expect(await f.h.rows('mutation_receipts')).toEqual(receipts);
  }
});

test('two_concurrent_transfers_to_different_members_commit_only_one_owner_change', async () => {
  const f = await fixture(); const invite = await f.owner.family.invite({ requestId: requestId('third-person') });
  const third = await f.outsider.family.join({ requestId: requestId('third-join'), token: invite.token });
  const results = await Promise.allSettled([
    f.owner.family.transferOwner(target(f.ownerCtx, f.memberCtx, 'transfer-b')),
    f.owner.family.transferOwner(target(f.ownerCtx, third, 'transfer-c')),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const owners = (await members(f)).filter(row => row.role === 'owner');
  expect(owners).toHaveLength(1); expect((await family(f)).ownerUid).toBe(owners[0]._id);
});

test('a_target_leaving_during_transfer_keeps_the_original_owner', async () => {
  const f = await fixture(); const hold = holdBusiness(f);
  const transfer = f.owner.family.transferOwner(target(f.ownerCtx, f.memberCtx));
  await hold.reached; await f.member.family.leave(mutation(f.memberCtx)); hold.release();
  await expect(transfer).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await family(f)).ownerUid).toBe('owner'); expect((await members(f)).filter(row => row.role === 'owner')).toHaveLength(1);
});

test('a_lifecycle_receipt_does_not_bypass_the_persistent_request_limit', async () => {
  const f = await fixture(); const input = mutation(f.memberCtx);
  for (let attempt = 0; attempt < 10; attempt++) await f.member.family.leave(input);
  await expect(f.member.family.leave(input)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await members(f)).toHaveLength(1);
});

test.each(['leave', 'removeMember', 'transferOwner'] as const)('%s_recovers_a_lost_commit_acknowledgement', async method => {
  const f = await fixture(); const transaction = f.h.database.transaction; let fired = false;
  f.h.database.transaction = fn => transaction(async tx => {
    const insert = tx.insert.bind(tx);
    tx.insert = async (collection, id, value) => { await insert(collection, id, value); if (collection === 'mutation_receipts' && !fired) { fired = true; f.h.memory.failNext('after-commit', new DatabaseFault('commit-unknown')); } };
    return fn(tx);
  });
  if (method === 'leave') await f.member.family.leave(mutation(f.memberCtx));
  else await f.owner.family[method](target(f.ownerCtx, f.memberCtx));
  expect((await members(f)).filter(row => row.role === 'owner')).toHaveLength(1);
  expect((await family(f)).version).toBe(3);
});

test('concurrent_transfer_and_removal_cannot_leave_zero_or_two_owners', async () => {
  const f = await fixture(); const hold = holdBusiness(f);
  const transfer = f.owner.family.transferOwner(target(f.ownerCtx, f.memberCtx, 'transfer-race'));
  await hold.reached;
  await f.owner.family.removeMember(target(f.ownerCtx, f.memberCtx, 'remove-race'));
  hold.release(); await expect(transfer).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await members(f)).filter(row => row.role === 'owner')).toHaveLength(1);
  expect((await family(f)).ownerUid).toBe('owner');
});

test('removal_wins_against_an_in_flight_protected_write_and_rejoin_does_not_revive_it', async () => {
  const f = await fixture(); const barrier = f.h.memory.barrierNextCommit();
  const pending = f.h.database.transaction(async tx => {
    await guardMutation(tx, f.memberCtx);
    await tx.insert('mutation_receipts', 'test-only-protected-effect', { _id: 'test-only-protected-effect' });
  });
  await barrier.reached;
  await f.owner.family.removeMember(target(f.ownerCtx, f.memberCtx));
  const invite = await f.owner.family.invite({ requestId: requestId('race-reinvite') });
  await f.member.family.join({ requestId: requestId('race-rejoin'), token: invite.token });
  barrier.release(); await expect(pending).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await f.h.rows<{ _id: string }>('mutation_receipts')).some(row => row._id === 'test-only-protected-effect')).toBe(false);
});
