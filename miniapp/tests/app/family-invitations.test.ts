import { createImportsApi } from '../../src/features/imports/api';
import { createMediaApi } from '../../src/features/media/api';
import { createRecipesApi } from '../../src/features/recipes/api';
// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import Home from '../../src/pages/family/home.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import Login from '../../src/pages/account/login.vue';
import { createHarness } from '../support/harness';
import { mountPage } from '../support/uni-stubs';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { AppError } from '../../src/shared/errors';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createCloudClient } from '../../src/shared/cloud-client';
import { createAccountApi } from '../../src/features/auth/api';
import { createFamilyApi } from '../../src/features/family/api';

const navigation: string[] = []; const copies: string[] = [];
beforeEach(() => { navigation.length = 0; copies.length = 0; vi.stubGlobal('uni', {
  switchTab: ({ url }: { url: string }) => navigation.push(url), reLaunch: ({ url }: { url: string }) => navigation.push(url), navigateTo: ({ url }: { url: string }) => navigation.push(url),
  setClipboardData: ({ data }: { data: string }) => { copies.push(data); return Promise.resolve({}); }, hideShareMenu: () => {},
}); });
afterEach(() => { vi.unstubAllGlobals(); });
async function fixture() {
  const h = createHarness(); for (const uid of ['owner', 'bob']) await h.seedIdentity({ uid });
  const owner = h.client('owner'); await owner.family.create({ requestId: 'page-create-000001', name: '家常饭' });
  return { h, owner, bob: h.client('bob') };
}
test('home_exposes_owner_invitation_and_member_list_and_onboarding_has_manual_join', async () => {
  const { owner, bob } = await fixture();
  const home = mountPage(Home, { client: owner }); await home.show();
  expect(home.wrapper.find('[data-invite]').exists()).toBe(true); expect(home.wrapper.find('[data-members]').exists()).toBe(true);
  home.wrapper.unmount();
  const onboarding = mountPage(Onboarding, { client: bob }); await onboarding.show(); expect(onboarding.wrapper.find('[data-open-join]').exists()).toBe(true); onboarding.wrapper.unmount();
});
test('owner_generates_before_sharing_and_revokes_without_placing_token_in_storage', async () => {
  const Invite = (await import('../../src/pages/family/invite.vue')).default;
  const { owner } = await fixture(); const storage = createMemoryStorage();
  const page = mountPage(Invite, { client: owner, storage }); await page.show();
  await page.wrapper.find('[data-generate]').trigger('click'); await flushPromises();
  const share = await page.share(); expect(share.path).toMatch(/^\/pages\/family\/join\?token=v1/);
  const token = decodeURIComponent(share.path.split('token=')[1]);
  await page.wrapper.find('[data-copy]').trigger('click'); expect(copies).toEqual([token]);
  expect(JSON.stringify(storage.get('home.family.invite.v1:owner') ?? null)).not.toContain(token);
  expect(share.title).not.toContain('家常饭'); expect(share.imageUrl).toBe('/static/family-share.png');
  await page.wrapper.find('[data-revoke]').trigger('click'); await flushPromises();
  expect(page.wrapper.text()).toContain('已撤销'); expect((await page.share()).path).not.toContain('token=');
  await page.hide(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});
test('card_join_requires_confirmation_and_success_shows_shared_members', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const Members = (await import('../../src/pages/family/members.vue')).default;
  const { owner, bob } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  const page = mountPage(Join, { client: bob }); await page.load({ token: invite.token }); await page.show();
  expect(await bob.family.current()).toBeNull(); expect(page.wrapper.find('[data-confirm-join]').exists()).toBe(true);
  await page.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
  expect(navigation.at(-1)).toBe('/pages/recipes/index'); page.wrapper.unmount();
  const members = mountPage(Members, { client: bob }); await members.show();
  expect(members.wrapper.findAll('[data-member]')).toHaveLength(2); members.wrapper.unmount();
});
test('anonymous_card_entry_returns_to_join_after_login_without_auto_consumption', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { h, owner, bob } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  h.revokeToken('bob'); const page = mountPage(Join, { client: bob }); await page.load({ token: invite.token }); await page.show();
  expect(navigation.at(-1)).toBe('/pages/account/login');
  const login = mountPage(Login, { client: bob, controllers: page.controllers }); await login.show(); await h.seedIdentity({ uid: 'bob' });
  await login.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
  expect(navigation.at(-1)).toBe('/pages/family/join'); expect(await bob.family.current()).toBeNull();
  login.wrapper.unmount(); page.wrapper.unmount();
});
test('uncertain_join_persists_only_digest_and_original_request_and_blocks_new_creation', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { owner, bob } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  const storage = createMemoryStorage(); const original = bob.family.join;
  const calls: string[] = [];
  vi.spyOn(bob.family, 'join').mockImplementation(async input => { calls.push(input.requestId); if (calls.length === 1) throw new AppError('UNAVAILABLE'); return original(input); });
  const page = mountPage(Join, { client: bob, storage }); await page.load({ token: invite.token }); await page.show();
  await page.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
  const saved = storage.get('home.family.join.v1:bob'); expect(JSON.stringify(saved)).not.toContain(invite.token);
  expect(saved).toMatchObject({ requestId: calls[0], tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await expect(page.family.submit('不能同时创建')).rejects.toMatchObject({ code: 'CONFLICT' });
  await page.hide(); page.wrapper.unmount();
  const cold = mountPage(Join, { client: bob, storage }); await cold.load({ token: invite.token }); await cold.show();
  await cold.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
  expect(calls).toEqual([calls[0], calls[0]]); expect(storage.get('home.family.join.v1:bob')).toBeUndefined(); cold.wrapper.unmount();
});
test('hidden_or_logged_out_join_does_not_navigate_on_a_late_success', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { owner, bob } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  const original = bob.family.join; const gate = deferCall();
  vi.spyOn(bob.family, 'join').mockImplementation(async input => { const result = await original(input); await gate.promise; return result; });
  const page = mountPage(Join, { client: bob }); await page.load({ token: invite.token }); await page.show();
  await page.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises(); await page.hide();
  await page.auth.signOut(); gate.resolve(null); await flushPromises();
  expect(navigation).not.toContain('/pages/recipes/index'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); page.wrapper.unmount();
});

test('a_rejected_invitation_can_be_replaced_by_a_new_manual_code', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { owner, bob } = await fixture();
  const first = await owner.family.invite({ requestId: 'page-invite-000001' }); const second = await owner.family.invite({ requestId: 'page-invite-000002' });
  await owner.family.revokeInvite({ requestId: 'page-revoke-000001', invitationId: first.invitationId });
  const page = mountPage(Join, { client: bob }); await page.load({ token: first.token }); await page.show();
  await page.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
  expect(page.wrapper.find('input').exists()).toBe(true);
  await page.wrapper.find('input').setValue(second.token); await page.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
  expect(navigation.at(-1)).toBe('/pages/recipes/index'); page.wrapper.unmount();
});

test('manual_invitation_draft_is_erased_when_page_hides', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { owner, bob } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  const page = mountPage(Join, { client: bob }); await page.show(); await page.wrapper.find('input').setValue(invite.token);
  await page.hide(); await page.show(); expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe(''); page.wrapper.unmount();
});

test('uncertain_family_creation_blocks_join_and_provides_a_route_to_resume_creation', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { owner, bob } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  const storage = createMemoryStorage(); storage.set('home.family.create.v1:bob', { requestId: 'unresolved-create-01', name: '未决家庭', uncertain: true });
  const page = mountPage(Join, { client: bob, storage }); await page.load({ token: invite.token }); await page.show();
  const join = vi.spyOn(bob.family, 'join'); await page.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises(); expect(join).not.toHaveBeenCalled();
  await page.wrapper.find('[data-back-onboarding]').trigger('click'); expect(navigation.at(-1)).toBe('/pages/family/onboarding'); page.wrapper.unmount();
});

test('unloading_a_hidden_old_page_cannot_clear_the_new_pages_member_list', async () => {
  const Members = (await import('../../src/pages/family/members.vue')).default;
  const Invite = (await import('../../src/pages/family/invite.vue')).default;
  const { owner } = await fixture();
  const old = mountPage(Invite, { client: owner }); await old.show(); await old.hide();
  const next = mountPage(Members, { client: owner, controllers: old.controllers }); await next.show(); expect(next.wrapper.findAll('[data-member]')).toHaveLength(1);
  await old.unload(); expect(next.wrapper.findAll('[data-member]')).toHaveLength(1);
  next.wrapper.unmount(); old.wrapper.unmount();
});

test('real_sdk_anonymous_close_preserves_card_but_explicit_logout_erases_it', async () => {
  const Join = (await import('../../src/pages/family/join.vue')).default;
  const { owner } = await fixture(); const invite = await owner.family.invite({ requestId: 'page-invite-000001' });
  const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage); let signedIn = false;
  const cloud = createCloudClient({ boundary, transport: async (object, method) => {
    if (object === 'uni-id-co' && method === 'loginByWeixin') { signedIn = true; return { errCode: 0 }; }
    if (object === 'uni-id-co' && method === 'logout') { signedIn = false; return { errCode: 0 }; }
    if (object === 'account-co' && method === 'session') return signedIn ? { errCode: 0, data: { uid: 'bob' } } : { errCode: 'AUTH_REQUIRED' };
    if (object === 'family-co' && method === 'current') return { errCode: 0, data: null };
    throw new Error('Unexpected transport operation');
  } });
  const client = { imports: createImportsApi({ boundary, invoke: cloud.invoke }), media: createMediaApi({ boundary, invoke: cloud.invoke }), recipes: createRecipesApi({ boundary, invoke: cloud.invoke }), account: createAccountApi({ wire: cloud.account, boundary, platformLogin: async () => 'fixture-code' }), family: createFamilyApi({ boundary, invoke: cloud.invoke }) };
  const page = mountPage(Join, { client, storage }); await page.load({ token: invite.token }); await page.show();
  expect(page.auth.phase.value).toBe('anonymous'); expect(page.controllers.invitations.hasLoginContinuation()).toBe(true);
  await page.auth.signOut(); expect(page.controllers.invitations.hasLoginContinuation()).toBe(false);
  await page.load({ token: invite.token });
  const login = mountPage(Login, { client, controllers: page.controllers }); await login.show();
  await login.wrapper.find('[data-sign-in]').trigger('click'); await flushPromises();
  expect(navigation.at(-1)).toBe('/pages/family/join'); expect(page.controllers.invitations.hasLoginContinuation()).toBe(true);
  await page.auth.signOut(); expect(page.controllers.invitations.hasLoginContinuation()).toBe(false);
  login.wrapper.unmount(); page.wrapper.unmount();
});

test('used_invitation_revoke_failure_cannot_block_revoking_an_independent_invitation', async () => {
  const Invite = (await import('../../src/pages/family/invite.vue')).default;
  const { owner, bob } = await fixture();
  const a = await owner.family.invite({ requestId: 'page-invite-000001' }); const b = await owner.family.invite({ requestId: 'page-invite-000002' });
  const page = mountPage(Invite, { client: owner }); await page.show();
  await bob.family.join({ requestId: 'page-join-00000001', token: a.token });
  await expect(page.controllers.invitations.revoke(a.invitationId)).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(page.controllers.invitations.revoke(b.invitationId)).resolves.toBeUndefined();
  expect((await owner.family.invitations({})).items.find(item => item.invitationId === b.invitationId)?.status).toBe('revoked'); page.wrapper.unmount();
});

test('a_revoke_committed_while_hidden_cannot_lock_other_invites_after_reopen', async () => {
  const Invite = (await import('../../src/pages/family/invite.vue')).default;
  const { owner } = await fixture(); const storage = createMemoryStorage();
  const a = await owner.family.invite({ requestId: 'page-invite-000001' }); const b = await owner.family.invite({ requestId: 'page-invite-000002' });
  const original = owner.family.revokeInvite; const gate = deferCall();
  vi.spyOn(owner.family, 'revokeInvite').mockImplementationOnce(async input => { await original(input); await gate.promise; });
  const page = mountPage(Invite, { client: owner, storage }); await page.show();
  const pending = page.controllers.invitations.revoke(a.invitationId).catch(error => error); await flushPromises(); await page.hide(); gate.resolve(null); await pending;
  await page.show(); await expect(page.controllers.invitations.revoke(b.invitationId)).resolves.toBeUndefined();
  expect((await owner.family.invitations({})).items.every(item => item.status === 'revoked')).toBe(true); page.wrapper.unmount();
});

test('uncertain_revoke_is_scoped_to_its_invitation_and_reuses_its_original_request', async () => {
  const Invite = (await import('../../src/pages/family/invite.vue')).default;
  const { owner } = await fixture();
  const a = await owner.family.invite({ requestId: 'page-invite-000001' }); const b = await owner.family.invite({ requestId: 'page-invite-000002' });
  const original = owner.family.revokeInvite; const calls: { invitationId: string; requestId: string }[] = [];
  vi.spyOn(owner.family, 'revokeInvite').mockImplementation(async input => { calls.push(input); if (calls.length === 1) throw new AppError('UNAVAILABLE'); await original(input); });
  const page = mountPage(Invite, { client: owner }); await page.show();
  await expect(page.controllers.invitations.revoke(a.invitationId)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await page.controllers.invitations.revoke(b.invitationId); await page.controllers.invitations.revoke(a.invitationId);
  expect(calls.map(item => item.invitationId)).toEqual([a.invitationId, b.invitationId, a.invitationId]);
  expect(calls[2].requestId).toBe(calls[0].requestId); expect(calls[1].requestId).not.toBe(calls[0].requestId); page.wrapper.unmount();
});
