import { createApp } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';
import { provideAppClient } from '../../src/shared/app-client';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { invitedFamilyFixture } from '../support/family-fixtures';
import { AppError } from '../../src/shared/errors';

const disposables: ReturnType<typeof provideAppClient>[] = [];
afterEach(() => { for (const c of disposables.splice(0)) { c.membership?.dispose(); c.invitations.dispose(); c.family.dispose(); } });
async function setup(role: 'owner' | 'member' = 'owner') {
  const f = await invitedFamilyFixture(); const client = f[role]; const storage = createMemoryStorage(); let id = 0;
  function controllers() {
    const c = provideAppClient(createApp({}), client, { storage, newRequestId: async () => `controller-membership-${++id}` });
    disposables.push(c); return c;
  }
  const c = controllers(); await c.family.load(); await c.invitations.loadMembers();
  const target = c.invitations.members.value.find(row => row.uid === 'member')!;
  return { ...f, client, c, storage, controllers, target };
}
test('a_committed_transfer_with_a_lost_response_resumes_after_current_returns_a_new_member_generation', async () => {
  const f = await setup(); const original = f.client.family.transferOwner; const sent: unknown[] = [];
  vi.spyOn(f.client.family, 'transferOwner').mockImplementation(async input => { sent.push(input); const result = await original(input); if (sent.length === 1) throw new AppError('UNAVAILABLE'); return result; });
  await expect(f.c.membership.run('transferOwner', f.target)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const cold = f.controllers(); await cold.family.load(); expect(cold.family.view.value?.role).toBe('member');
  expect(await cold.membership.resume()).toBe(true); await cold.family.load();
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  expect(cold.family.view.value?.role).toBe('member'); expect(cold.membership.pending.value).toBeNull();
});
test('a_committed_leave_resumes_without_a_member_slot_and_does_not_sign_out', async () => {
  const f = await setup('member'); const original = f.client.family.leave; let sends = 0;
  vi.spyOn(f.client.family, 'leave').mockImplementation(async input => { await original(input); if (++sends === 1) throw new AppError('UNAVAILABLE'); });
  await expect(f.c.membership.run('leave')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const cold = f.controllers(); await cold.family.load(); expect(cold.family.view.value).toBeNull();
  await cold.membership.resume(); await cold.family.load();
  expect(cold.auth.phase.value).toBe('authenticated'); expect(sends).toBe(2); expect(cold.membership.pending.value).toBeNull();
});
test('an_uncommitted_intent_keeps_its_payload_and_blocks_a_different_target', async () => {
  const f = await setup(); const original = f.client.family.removeMember; const sent: unknown[] = [];
  vi.spyOn(f.client.family, 'removeMember').mockImplementation(async input => { sent.push(input); if (sent.length === 1) throw new AppError('UNAVAILABLE'); return original(input); });
  await expect(f.c.membership.run('removeMember', f.target)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await f.c.family.load();
  await expect(f.c.membership.run('transferOwner', f.target)).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.c.membership.resume();
  expect(sent[1]).toEqual(sent[0]); expect(await f.member.family.current()).toBeNull();
});
test('transient_checking_hides_state_without_erasing_the_durable_pending_intent', async () => {
  const f = await setup('member'); vi.spyOn(f.client.family, 'leave').mockRejectedValue(new AppError('UNAVAILABLE'));
  await expect(f.c.membership.run('leave')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const saved = f.storage.get('home.family.membership.v1:member');
  await f.c.family.load(); expect(f.storage.get('home.family.membership.v1:member')).toEqual(saved);
});
test('a_late_hidden_success_cannot_clear_a_newer_attempt_or_repopulate_protected_caches', async () => {
  const f = await setup(); const gate = deferCall(); const original = f.client.family.removeMember;
  vi.spyOn(f.client.family, 'removeMember').mockImplementation(async input => { await original(input); await gate.promise; });
  const pending = f.c.membership.run('removeMember', f.target); const rejected = expect(pending).rejects.toMatchObject({ code: 'CONFLICT' });
  await vi.waitFor(() => expect(f.c.membership.busy.value).toBe(true)); await vi.waitFor(async () => expect(await f.member.family.current()).toBeNull());
  f.c.membership.conceal(); gate.resolve(null); await rejected;
  expect(f.storage.get('home.family.membership.v1:owner')).toBeTruthy();
});
test('sign_out_erases_durable_pending_and_late_success_cannot_restore_it', async () => {
  const f = await setup('member'); const gate = deferCall(); const original = f.client.family.leave;
  vi.spyOn(f.client.family, 'leave').mockImplementation(async input => { await original(input); await gate.promise; });
  const pending = f.c.membership.run('leave'); const rejected = expect(pending).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  await vi.waitFor(async () => expect(await f.member.family.current()).toBeNull());
  await f.c.auth.signOut(); gate.resolve(null); await rejected;
  expect(f.storage.get('home.family.membership.v1:member')).toBeUndefined(); expect(f.c.family.view.value).toBeNull();
});
test('an_old_leave_receipt_is_resolved_without_deleting_a_new_family', async () => {
  const f = await setup('member'); const original = f.client.family.leave;
  vi.spyOn(f.client.family, 'leave').mockImplementation(async input => { await original(input); throw new AppError('UNAVAILABLE'); });
  await expect(f.c.membership.run('leave')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const next = await f.client.family.create({ requestId: 'controller-new-family', name: '新家庭' });
  vi.mocked(f.client.family.leave).mockImplementation(original);
  const cold = f.controllers(); await cold.family.load(); await cold.membership.resume(); await cold.family.load();
  expect(cold.family.view.value).toEqual(next);
});
