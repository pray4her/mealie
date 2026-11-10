// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import Members from '../../src/pages/family/members.vue';
import Home from '../../src/pages/family/home.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import { mountPage } from '../support/uni-stubs';
import { invitedFamilyFixture } from '../support/family-fixtures';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { AppError } from '../../src/shared/errors';

const navigation: string[] = []; let confirm = true;
beforeEach(() => { navigation.length = 0; confirm = true; vi.stubGlobal('uni', {
  switchTab: ({ url }: { url: string }) => navigation.push(url), reLaunch: ({ url }: { url: string }) => navigation.push(url),
  showModal: vi.fn(async () => ({ confirm, cancel: !confirm })),
}); });
afterEach(() => { vi.unstubAllGlobals(); });
test('member_can_cancel_then_leave_while_staying_logged_in', async () => {
  const f = await invitedFamilyFixture(); const page = mountPage(Members, { client: f.member }); await page.show();
  expect(page.wrapper.find('[data-remove-member]').exists()).toBe(false);
  confirm = false; await page.wrapper.find('[data-leave-family]').trigger('click'); await flushPromises();
  expect(await f.member.family.current()).not.toBeNull();
  confirm = true; await page.wrapper.find('[data-leave-family]').trigger('click'); await flushPromises();
  expect(navigation.at(-1)).toBe('/pages/family/onboarding'); expect(page.auth.phase.value).toBe('authenticated');
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});
test('owner_sees_target_identity_and_can_remove_another_member', async () => {
  const f = await invitedFamilyFixture(); const page = mountPage(Members, { client: f.owner }); await page.show();
  expect(page.wrapper.find('[data-leave-family]').exists()).toBe(false);
  expect(page.wrapper.find('[data-owner-leave-hint]').exists()).toBe(true);
  const row = page.wrapper.findAll('[data-member]').find(row => row.text().includes('member'))!;
  await row.find('[data-remove-member]').trigger('click'); await flushPromises();
  expect(uni.showModal).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('member') }));
  expect(await f.member.family.current()).toBeNull(); expect(page.wrapper.findAll('[data-member]')).toHaveLength(1); page.wrapper.unmount();
});
test('transfer_refreshes_roles_and_hides_owner_controls', async () => {
  const f = await invitedFamilyFixture(); const page = mountPage(Members, { client: f.owner }); await page.show();
  await page.wrapper.find('[data-transfer-owner]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('[data-transfer-owner]').exists()).toBe(false); expect(page.wrapper.find('[data-remove-member]').exists()).toBe(false);
  expect(page.wrapper.find('[data-leave-family]').exists()).toBe(true); expect(page.family.view.value?.role).toBe('member'); page.wrapper.unmount();
});
test('cold_start_resumes_a_lost_transfer_before_applying_member_role_gating', async () => {
  const f = await invitedFamilyFixture(); const storage = createMemoryStorage(); const original = f.owner.family.transferOwner; let sends = 0;
  vi.spyOn(f.owner.family, 'transferOwner').mockImplementation(async input => { const result = await original(input); if (++sends === 1) throw new AppError('UNAVAILABLE'); return result; });
  const first = mountPage(Members, { client: f.owner, storage }); await first.show();
  await first.wrapper.find('[data-transfer-owner]').trigger('click'); await flushPromises(); await first.hide(); first.wrapper.unmount();
  const cold = mountPage(Members, { client: f.owner, storage }); await cold.show();
  expect(sends).toBe(2); expect(cold.family.view.value?.role).toBe('member'); expect(cold.wrapper.find('[data-leave-family]').exists()).toBe(true); cold.wrapper.unmount();
});
test.each([Members, Home, Onboarding])('every_family_entry_resumes_a_lost_leave_before_redirecting', async component => {
  const f = await invitedFamilyFixture(); const storage = createMemoryStorage(); const original = f.member.family.leave; let sends = 0;
  vi.spyOn(f.member.family, 'leave').mockImplementation(async input => { await original(input); if (++sends === 1) throw new AppError('UNAVAILABLE'); });
  const first = mountPage(Members, { client: f.member, storage }); await first.show();
  await first.wrapper.find('[data-leave-family]').trigger('click'); await flushPromises(); await first.hide(); first.wrapper.unmount();
  const cold = mountPage(component, { client: f.member, storage }); await cold.show();
  expect(sends).toBe(2); expect(cold.family.view.value).toBeNull(); expect(cold.auth.phase.value).toBe('authenticated');
  if (component !== Onboarding) expect(navigation.at(-1)).toBe('/pages/family/onboarding');
  else expect(cold.wrapper.find('[data-family-form]').exists()).toBe(true);
  cold.wrapper.unmount();
});
test('duplicate_taps_while_confirmation_is_pending_send_only_one_request', async () => {
  const f = await invitedFamilyFixture(); const gate = deferCall(); const original = f.owner.family.removeMember;
  const calls = vi.spyOn(f.owner.family, 'removeMember').mockImplementation(original);
  vi.mocked(uni.showModal).mockImplementation(async () => { await gate.promise; return { confirm: true, cancel: false } as UniApp.ShowModalRes; });
  const page = mountPage(Members, { client: f.owner }); await page.show();
  await page.wrapper.find('[data-remove-member]').trigger('click'); await page.wrapper.find('[data-remove-member]').trigger('click');
  expect(uni.showModal).toHaveBeenCalledTimes(1); gate.resolve(null); await flushPromises(); expect(calls).toHaveBeenCalledTimes(1); page.wrapper.unmount();
});
test('a_confirmation_resolving_after_hide_cannot_send_a_membership_request', async () => {
  const f = await invitedFamilyFixture(); const gate = deferCall(); const calls = vi.spyOn(f.member.family, 'leave');
  vi.mocked(uni.showModal).mockImplementation(async () => { await gate.promise; return { confirm: true, cancel: false } as UniApp.ShowModalRes; });
  const page = mountPage(Members, { client: f.member }); await page.show();
  await page.wrapper.find('[data-leave-family]').trigger('click'); await page.hide(); gate.resolve(null); await flushPromises();
  expect(calls).not.toHaveBeenCalled(); expect(navigation).toEqual([]); page.wrapper.unmount();
});
test('a_removed_member_returns_to_onboarding_without_displaying_stale_names', async () => {
  const f = await invitedFamilyFixture(); const page = mountPage(Members, { client: f.member }); await page.show();
  const owner = (await f.owner.family.current())!; const member = (await f.member.family.current())!;
  await f.owner.family.removeMember({ requestId: 'page-external-remove', familyId: owner.familyId, generation: owner.generation, uid: member.uid, targetGeneration: member.generation });
  await page.show(); expect(navigation.at(-1)).toBe('/pages/family/onboarding'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  expect(page.controllers.invitations.members.value).toEqual([]); page.wrapper.unmount();
});

test.each([Home, Onboarding])('a_hidden_entry_cannot_start_durable_recovery_after_a_late_current_response', async component => {
  const f = await invitedFamilyFixture(); const storage = createMemoryStorage();
  const originalLeave = f.member.family.leave; const sends = vi.spyOn(f.member.family, 'leave').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const first = mountPage(Members, { client: f.member, storage }); await first.show();
  await first.wrapper.find('[data-leave-family]').trigger('click'); await flushPromises(); await first.hide(); first.wrapper.unmount();
  sends.mockImplementation(originalLeave);
  const gate = deferCall(); const originalCurrent = f.member.family.current;
  const read = vi.spyOn(f.member.family, 'current').mockImplementationOnce(async () => { const result = await originalCurrent(); await gate.promise; return result; });
  const page = mountPage(component, { client: f.member, storage }); const showing = page.show();
  await flushPromises(); expect(read).toHaveBeenCalled(); await page.hide(); gate.resolve(null); await showing;
  expect(sends).toHaveBeenCalledTimes(1); expect(storage.get('home.family.membership.v1:member')).toBeTruthy();
  expect(navigation).toEqual([]); page.wrapper.unmount();
});

test.each([Home, Onboarding])('a_terminal_stale_intent_refreshes_a_later_family_in_the_same_show', async component => {
  const f = await invitedFamilyFixture(); const storage = createMemoryStorage(); const originalLeave = f.member.family.leave;
  const sends = vi.spyOn(f.member.family, 'leave').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const first = mountPage(Members, { client: f.member, storage }); await first.show();
  await first.wrapper.find('[data-leave-family]').trigger('click'); await flushPromises(); await first.hide(); first.wrapper.unmount();
  const current = (await f.member.family.current())!;
  await originalLeave({ requestId: 'other-device-real-leave', familyId: current.familyId, generation: current.generation });
  const next = await f.member.family.create({ requestId: 'other-device-create-family', name: '另一个家庭' });
  sends.mockImplementation(originalLeave);
  const page = mountPage(component, { client: f.member, storage }); await page.show();
  expect(page.family.phase.value).toBe('ready'); expect(page.family.view.value).toEqual(next);
  expect(storage.get('home.family.membership.v1:member')).toBeUndefined();
  if (component === Home) expect(page.wrapper.find('[data-protected]').exists()).toBe(true);
  else expect(navigation.at(-1)).toBe('/pages/recipes/index');
  page.wrapper.unmount();
});
