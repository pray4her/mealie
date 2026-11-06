import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';
import { deferCall } from '../support/sdk-transport';
import { DatabaseFault } from 'home-kernel';
import type { CreationReceipt, FamilyRecord, MemberRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-family/model';

const input = { requestId: 'request-00000001', name: '  我家  ' };

test('creates_one_owner_one_slot_and_one_receipt', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const result = await h.family('alice').create(input);
  expect(result).toMatchObject({ uid: 'alice', name: '我家', role: 'owner' });
  expect(result.generation).toBeTruthy();
  expect(await h.family('alice').current()).toEqual(result);
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
});

test('content_rejection_does_not_create_a_family', async () => {
  const h = createHarness({ content: { async checkText() { return 'rejected'; } } });
  await h.seedIdentity({ uid: 'alice' });
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await h.rows('families')).toEqual([]);
  expect(await h.rows('family_members')).toEqual([]);
  expect(await h.rows('mutation_receipts')).toEqual([]);
});

test('commit_unknown_recovers_original_receipt_without_repeating_write', async () => {
  let inject = () => {};
  const h = createHarness({ content: { async checkText() { inject(); return 'allowed'; } } });
  inject = () => h.memory.failNext('after-commit');
  await h.seedIdentity({ uid: 'alice' });
  const result = await h.family('alice').create(input);
  expect(await h.family('alice').create(input)).toEqual(result);
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
});

test('same_request_replays_original_result_after_name_normalization', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const original = await h.family('alice').create(input);
  expect(await h.family('alice').create({ ...input, name: '我家' })).toEqual(original);
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
});

test('new_request_for_existing_member_is_rejected_without_second_family', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  await h.family('alice').create(input);
  await expect(h.family('alice').create({ ...input, requestId: 'request-00000002' })).rejects.toMatchObject({ code: 'ALREADY_IN_FAMILY' });
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
});

test.each([
  null, [], {}, { ...input, name: {} }, { ...input, name: '' }, { ...input, name: '   ' },
  { ...input, name: '家'.repeat(41) }, { ...input, name: '我\u0000家' },
  { ...input, requestId: 'a'.repeat(15) }, { ...input, requestId: 'a'.repeat(129) },
  { ...input, requestId: 'a'.repeat(16) + '\n' }, { ...input, requestId: 123 },
  { ...input, uid: 'other' }, { ...input, role: 'owner' }, { ...input, $set: {} },
])('invalid_or_extra_creation_input_is_rejected_without_writes: %j', async bad => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  await expect(Reflect.apply(h.family('alice').create, undefined, [bad])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await h.rows('families')).toEqual([]);
  expect(await h.rows('family_members')).toEqual([]);
  expect(await h.rows('mutation_receipts')).toEqual([]);
});

test.each([
  { label: 'same_id_same_name', second: input, error: null },
  { label: 'different_ids', second: { ...input, requestId: 'request-00000002' }, error: 'ALREADY_IN_FAMILY' },
  { label: 'same_id_different_names', second: { ...input, name: '另一家' }, error: 'CONFLICT' },
])('forced_family_write_competition_leaves_one_family: $label', async ({ second: secondInput, error }) => {
  const entered = [deferCall(), deferCall()]; const audits = [deferCall(), deferCall()]; let calls = 0;
  const h = createHarness({ content: { async checkText() {
    const index = calls++; entered[index].resolve(null); await audits[index].promise; return 'allowed';
  } } });
  await h.seedIdentity({ uid: 'alice' });
  const first = h.family('alice').create(input); const second = h.family('alice').create(secondInput);
  await Promise.all(entered.map(item => item.promise)); // Both quotas and prechecks already committed.
  const barrier = h.memory.barrierNextCommit();
  audits[0].resolve(null); await barrier.reached; // The first family write is staged, not its quota.
  audits[1].resolve(null); const winner = await second;
  barrier.release();
  if (error) await expect(first).rejects.toMatchObject({ code: error }); else expect(await first).toEqual(winner);
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
  expect(await h.rows('request_limits')).toEqual([expect.objectContaining({ operation: 'family:create', count: 2 })]);
});

test('same_id_changed_payload_is_conflict', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const original = await h.family('alice').create(input);
  await expect(h.family('alice').create({ ...input, name: '另一家' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await h.family('alice').current()).toEqual(original);
});

test.each(['families', 'family_members', 'mutation_receipts'] as const)('rollback_at_insert_%s_leaves_no_partial_data', async collection => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  h.memory.failNext(`insert:${collection}`);
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await h.rows('families')).toEqual([]);
  expect(await h.rows('family_members')).toEqual([]);
  expect(await h.rows('mutation_receipts')).toEqual([]);
  expect(await h.rows('request_limits')).toEqual([expect.objectContaining({ count: 1 })]);
});

test('missing_receipt_keeps_unknown_commit_unavailable', async () => {
  let inject = () => {};
  const h = createHarness({ content: { async checkText() { inject(); return 'allowed'; } } });
  inject = () => h.memory.failNext('commit', new DatabaseFault('commit-unknown'));
  await h.seedIdentity({ uid: 'alice' });
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await h.rows('families')).toEqual([]);
  expect(await h.rows('family_members')).toEqual([]);
  expect(await h.rows('mutation_receipts')).toEqual([]);
});

test('malformed_receipt_name_is_not_replayed', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  await h.family('alice').create(input);
  const [receipt] = await h.rows<CreationReceipt>('mutation_receipts');
  h.memory.seed('mutation_receipts', receipt._id, { ...receipt, result: { ...receipt.result, name: '家'.repeat(41) } });
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test('receipt_name_must_match_its_original_payload_digest', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const original = await h.family('alice').create(input);
  const [receipt] = await h.rows<CreationReceipt>('mutation_receipts');
  h.memory.seed('mutation_receipts', receipt._id, { ...receipt, result: { ...receipt.result, name: '被改写的名字' } });
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await h.family('alice').current()).toEqual(original);
});

test('same_request_id_is_scoped_to_uid_and_family_names_need_not_be_unique', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); await h.seedIdentity({ uid: 'bob' });
  const alice = await h.family('alice').create(input); const bob = await h.family('bob').create(input);
  expect(alice.familyId).not.toBe(bob.familyId);
  expect(bob).toMatchObject({ uid: 'bob', name: '我家', role: 'owner' });
  expect(await h.rows('families')).toHaveLength(2);
  expect(await h.rows('family_members')).toHaveLength(2);
  expect(await h.rows('mutation_receipts')).toHaveLength(2);
});

test.each([16, 128])('accepts_request_id_boundary_%i_and_forty_non_bmp_characters', async length => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const result = await h.family('alice').create({ requestId: 'a'.repeat(length), name: '😀'.repeat(40) });
  expect(result.name).toBe('😀'.repeat(40));
  expect(await h.family('alice').current()).toEqual(result);
});

test('replay_returns_original_name_without_calling_unavailable_content_service', async () => {
  let unavailable = false; let checks = 0;
  const h = createHarness({ content: { async checkText() { checks++; if (unavailable) throw new Error('audit offline'); return 'allowed'; } } });
  await h.seedIdentity({ uid: 'alice' }); const original = await h.family('alice').create(input);
  const [family] = await h.rows<FamilyRecord>('families'); h.memory.seed('families', family._id, { ...family, name: '更新后的家' });
  unavailable = true;
  expect(await h.family('alice').create(input)).toEqual(original);
  expect(await h.family('alice').current()).toMatchObject({ name: '更新后的家' });
  expect(checks).toBe(1);
});

test('content_service_failure_leaves_no_family', async () => {
  const h = createHarness({ content: { async checkText() { throw new Error('provider details must stay private'); } } });
  await h.seedIdentity({ uid: 'alice' });
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
  expect(await h.rows('families')).toEqual([]);
  expect(await h.rows('family_members')).toEqual([]);
  expect(await h.rows('mutation_receipts')).toEqual([]);
});

test('membership_changes_while_content_check_waits_prevent_second_family', async () => {
  const entered = deferCall(); const release = deferCall(); let first = true;
  const h = createHarness({ content: { async checkText() {
    if (first) { first = false; entered.resolve(null); await release.promise; }
    return 'allowed';
  } } });
  await h.seedIdentity({ uid: 'alice' });
  const pending = h.family('alice').create(input); await entered.promise;
  const winner = await h.family('alice').create({ requestId: 'request-00000002', name: '赢家的家' });
  release.resolve(null);
  await expect(pending).rejects.toMatchObject({ code: 'ALREADY_IN_FAMILY' });
  expect(await h.family('alice').current()).toEqual(winner);
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('family_members')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
});

test('identity_revoked_while_content_check_waits_prevents_write', async () => {
  const entered = deferCall(); const release = deferCall();
  const h = createHarness({ content: { async checkText() { entered.resolve(null); await release.promise; return 'allowed'; } } });
  await h.seedIdentity({ uid: 'alice' });
  const pending = h.family('alice').create(input); await entered.promise;
  h.revokeToken('alice'); release.resolve(null);
  await expect(pending).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(await h.rows('families')).toEqual([]);
  expect(await h.rows('family_members')).toEqual([]);
  expect(await h.rows('mutation_receipts')).toEqual([]);
});

test('receipt_from_an_old_generation_cannot_restore_authorization', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  await h.family('alice').create(input);
  const [member] = await h.rows<MemberRecord>('family_members');
  h.memory.seed('family_members', 'alice', { ...member, generation: 'new-generation' });
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await h.family('alice').current()).toMatchObject({ generation: 'new-generation' });
});

test('receipt_does_not_allow_creation_after_membership_is_removed', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  await h.family('alice').create(input);
  await h.database.transaction(tx => tx.remove('family_members', 'alice'));
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect(await h.rows('families')).toHaveLength(1);
  expect(await h.rows('mutation_receipts')).toHaveLength(1);
});
