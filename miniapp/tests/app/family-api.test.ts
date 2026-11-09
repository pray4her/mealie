import { expect, test } from 'vitest';
import { createFamilyApi } from '../../src/features/family/api';
import { createCloudClient } from '../../src/shared/cloud-client';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage } from '../support/sdk-transport';
import { createHarness } from '../support/harness';
import { createProductionClient } from '../../src/shared/production-client';
import { afterEach, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

const view = { uid: 'alice', familyId: 'family-1', generation: 'generation-1', role: 'owner', name: '家' };
test('membership_api_forwards_only_the_complete_expected_context_and_checks_results', async () => {
  const sent: unknown[] = []; let data: unknown = null;
  const boundary = createSessionBoundary(createMemoryStorage());
  const api = createFamilyApi({ boundary, invoke: async (_object, method, input) => { sent.push([method, input]); return data as never; } });
  const leave = { requestId: 'membership-api-0001', familyId: 'home', generation: 'actor-generation' };
  const member = { ...leave, uid: 'bob', targetGeneration: 'target-generation' };
  await expect(api.leave(leave)).resolves.toBeUndefined(); await expect(api.removeMember(member)).resolves.toBeUndefined();
  data = { uid: 'alice', familyId: 'home', role: 'member', generation: 'new-generation' };
  expect(await api.transferOwner(member)).toEqual(data);
  expect(sent).toEqual([['leave', leave], ['removeMember', member], ['transferOwner', member]]);
  for (const method of ['leave', 'removeMember', 'transferOwner'] as const) {
    const privileged = { ...member, admin: true };
    await expect(api[method](privileged)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(api[method]({ ...member, generation: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  data = {}; await expect(api.leave(leave)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  data = { uid: 'alice', familyId: 'home', role: 'owner', generation: 'new' }; await expect(api.transferOwner(member)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('family_calls_use_the_shared_transport_and_explicit_empty_current_input', async () => {
  const sent: unknown[] = []; const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, transport: async (object, method, input) => {
    sent.push(JSON.parse(JSON.stringify([object, method, input]))); return { errCode: 0, data: method === 'current' ? null : view };
  } });
  const api = createFamilyApi({ invoke: cloud.invoke, boundary });
  expect(await api.current()).toBeNull();
  expect(await api.create({ requestId: 'request-000000001', name: '家' })).toEqual(view);
  expect(sent).toEqual([['family-co', 'current', {}], ['family-co', 'create', { requestId: 'request-000000001', name: '家' }]]);
});

test.each(['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'ALREADY_IN_FAMILY', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'INVALID_INPUT', 'INVITATION_INVALID', 'QUOTA_EXCEEDED', 'UNAVAILABLE'])('preserves_%s_and_only_auth_closes_the_session', async code => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'existing');
  const boundary = createSessionBoundary(storage);
  const cloud = createCloudClient({ boundary, transport: async () => { throw { errCode: code, errMsg: 'private' }; } });
  const api = createFamilyApi({ invoke: cloud.invoke, boundary });
  await expect(api.current()).rejects.toMatchObject({ code, message: code });
  expect(storage.get('uni_id_token')).toBe(code === 'AUTH_REQUIRED' ? undefined : 'existing');
  expect(storage.get('home.auth.closed')).toBe(code === 'AUTH_REQUIRED' ? true : undefined);
});

test('invitation_and_member_api_only_accept_safe_dtos', async () => {
  const boundary = createSessionBoundary(createMemoryStorage()); let data: unknown;
  const cloud = createCloudClient({ boundary, transport: async () => ({ errCode: 0, data }) });
  const api = createFamilyApi({ boundary, invoke: cloud.invoke });
  const token = `v1.test.${'a'.repeat(32)}.${'A'.repeat(43)}`;
  data = { invitationId: 'a'.repeat(32), token, expiresAt: 1_800_086_400_000 };
  expect(await api.invite({ requestId: 'api-invite-0000001' })).toEqual(data);
  data = { ...data as object, tokenHash: 'private' };
  await expect(api.invite({ requestId: 'api-invite-0000001' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  data = [{ uid: 'bob', nickname: '家人', role: 'member', openid: 'private' }];
  await expect(api.members()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  data = [{ uid: 'bob', nickname: '家人', role: 'member', generation: 'member-generation' }]; expect(await api.members()).toEqual(data);
  data = { uid: 'bob', familyId: 'home', role: 'member', generation: 'new' }; expect(await api.join({ requestId: 'api-join-000000001', token })).toEqual(data);
  data = { ...data as object, name: 'extra' };
  await expect(api.join({ requestId: 'api-join-000000001', token })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  data = null; await expect(api.revokeInvite({ requestId: 'api-revoke-000001', invitationId: 'a'.repeat(32) })).resolves.toBeUndefined();
  data = { items: [{ invitationId: 'a'.repeat(32), createdAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, status: 'pending' }] };
  expect(await api.invitations({})).toEqual(data);
  data = { ...data as object, token }; await expect(api.invitations({})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test.each([
  undefined, [], {}, { ...view, token: 'private' }, { ...view, role: 'admin' },
  { ...view, uid: '' }, { ...view, familyId: 2 }, { ...view, generation: '' },
  { ...view, name: ' ' }, { ...view, name: 'untrimmed ' }, { ...view, name: 'a\u0000b' },
  { ...view, name: '😀'.repeat(41) },
])('malformed_family_dto_is_never_an_empty_membership: %j', async data => {
  const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, transport: async () => ({ errCode: 0, data }) });
  const api = createFamilyApi({ invoke: cloud.invoke, boundary });
  await expect(api.current()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(api.create({ requestId: 'request-000000001', name: '家' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('create_requires_a_view_and_does_not_forward_untrusted_fields', async () => {
  let calls = 0; const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, transport: async () => { calls++; return { errCode: 0, data: null }; } });
  const api = createFamilyApi({ invoke: cloud.invoke, boundary });
  await expect(api.create({ requestId: 'request-000000001', name: '家' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const input = { requestId: 'request-000000001', name: '家', uid: 'bob' };
  await expect(api.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(calls).toBe(1);
});
test('harness_app_client_uses_the_same_authenticated_family_domain', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  expect(await client.family.current()).toBeNull();
  const family = await client.family.create({ requestId: 'request-000000001', name: '家' });
  expect(await h.family('alice').current()).toEqual(family);
  h.revokeToken('alice'); await expect(client.family.current()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
});
test('production_app_client_sends_empty_current_through_the_imported_object', async () => {
  const storage = createMemoryStorage(); const received: unknown[] = [];
  vi.stubGlobal('uni', { getStorageSync: storage.get, setStorageSync: storage.set, removeStorageSync: storage.remove });
  vi.stubGlobal('uniCloud', { importObject(object: string, options: unknown) {
    expect(object).toBe('family-co'); expect(options).toEqual({ customUI: true });
    return { async current(...args: unknown[]) { received.push(JSON.parse(JSON.stringify(args))); return { errCode: 0, data: null }; } };
  } });
  const client = createProductionClient(); expect(await client.family.current()).toBeNull(); expect(received).toEqual([[{}]]);
});
test('member_dto_and_forty_unicode_codepoints_are_valid_without_utf16_truncation', async () => {
  const boundary = createSessionBoundary(createMemoryStorage());
  const member = { ...view, role: 'member', name: '😀'.repeat(40) };
  const cloud = createCloudClient({ boundary, transport: async () => ({ errCode: 0, data: member }) });
  expect(await createFamilyApi({ boundary, invoke: cloud.invoke }).current()).toEqual(member);
});
test.each(['', ' ', '😀'.repeat(41), 'a\u007fb'])('invalid_client_name_prevents_send: %j', async name => {
  let sends = 0; const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, transport: async () => { sends++; return { errCode: 0, data: view }; } });
  await expect(createFamilyApi({ boundary, invoke: cloud.invoke }).create({ requestId: 'request-000000001', name })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(sends).toBe(0);
});
test.each(['short', 'a'.repeat(129), '非法request-000001'])('invalid_client_request_id_prevents_send: %s', async requestId => {
  let sends = 0; const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, transport: async () => { sends++; return { errCode: 0, data: view }; } });
  await expect(createFamilyApi({ boundary, invoke: cloud.invoke }).create({ requestId, name: '家' })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(sends).toBe(0);
});
test('an_unknown_sdk_failure_is_safe_unavailable_and_keeps_credentials', async () => {
  const storage = createMemoryStorage(); storage.set('uni_id_token', 'valid'); const boundary = createSessionBoundary(storage);
  const cloud = createCloudClient({ boundary, transport: async () => { throw { errCode: 'SDK_NETWORK', message: 'private-detail' }; } });
  await expect(createFamilyApi({ boundary, invoke: cloud.invoke }).current()).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' }); expect(storage.get('uni_id_token')).toBe('valid');
});
