import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';
import { familyFixture } from '../support/family-fixtures';
import { consumeRequestLimit } from 'home-kernel';
import { createMemoryDatabase } from '../support/memory-database';

test('uid_current_sixty_first_call_is_limited_across_service_instances', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const first = h.family('alice'); const second = h.family('alice');
  for (let i = 0; i < 60; i++) expect(await (i % 2 ? first : second).current()).toBeNull();
  await expect(second.current()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await h.rows('request_limits')).toHaveLength(1);
});

test('family_current_three_hundred_first_call_is_shared_by_members', async () => {
  const { h, memberRecord: member } = await familyFixture();
  for (let i = 0; i < 6; i++) {
    const uid = `reader-${i}`; await h.seedIdentity({ uid });
    h.memory.seed('family_members', uid, { ...member, _id: uid, generation: `generation-${i}` });
  }
  for (let i = 0; i < 300; i++) await h.family(`reader-${Math.floor(i / 50)}`).current();
  await expect(h.family('owner').current()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
});

test('uid_creation_eleventh_call_including_replays_is_limited', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const input = { requestId: 'request-00000001', name: '我家' };
  for (let i = 0; i < 10; i++) await h.family('alice').create(input);
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await h.rows('families')).toHaveLength(1);
});

test('malformed_limit_record_fails_closed_instead_of_accepting_extra_fields', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  await h.family('alice').current();
  const [bucket] = await h.rows<{ _id: string }>('request_limits');
  h.memory.seed('request_limits', bucket._id, { ...bucket, unexpected: true });
  await expect(h.family('alice').current()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test('window_boundary_reuses_bucket_and_resets_only_at_sixty_seconds', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  for (let i = 0; i < 60; i++) await h.family('alice').current();
  h.advance(59_999);
  await expect(h.family('alice').current()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  h.advance(1); expect(await h.family('alice').current()).toBeNull();
  expect(await h.rows('request_limits')).toEqual([expect.objectContaining({ count: 1, windowStart: 1_800_000_060_000 })]);
});

test('rolled_back_creation_does_not_refund_request_quota', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const input = { requestId: 'request-00000001', name: '我家' };
  for (let i = 0; i < 10; i++) {
    h.memory.failNext('insert:family_members');
    await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  }
  await expect(h.family('alice').create(input)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await h.rows('request_limits')).toEqual([expect.objectContaining({ count: 10 })]);
  expect(await h.rows('families')).toEqual([]);
});

test('competing_limit_transactions_cannot_bypass_one_remaining_slot', async () => {
  const memory = createMemoryDatabase(); const barrier = memory.barrierNextCommit();
  const input = { subject: 'uid:alice', operation: 'family:create', now: 0, max: 1 };
  const first = consumeRequestLimit(memory.database, input); await barrier.reached;
  await consumeRequestLimit(memory.database, input); barrier.release();
  await expect(first).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await memory.rows('request_limits')).toEqual([expect.objectContaining({ count: 1 })]);
});
