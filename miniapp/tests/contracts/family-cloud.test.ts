import { expect, test } from 'vitest';
import { createCloudClient } from '../../src/shared/cloud-client';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage } from '../support/sdk-transport';
import { createFamilyApi } from '../../src/features/family/api';
import { cloudFixture } from '../support/cloud-platform';
const fixture = (ack: 'object' | 'void' = 'object') => cloudFixture('family-co', ack);
test('real_public_exports_are_lazy_and_current_has_only_safe_dto_and_top_level_token', async () => {
  const f = fixture(); expect(Object.keys(f.entry).sort()).toEqual(['create', 'current', 'invitations', 'invite', 'join', 'leave', 'members', 'removeMember', 'revokeInvite', 'transferOwner']); expect(f.sdkImports).toBe(0); expect(f.transactions).toBe(0);
  expect(await f.entry.current.call(f.context)).toEqual({ errCode: 0, data: null, newToken: { token: 'renewed-token', tokenExpired: expect.any(Number) } });
});

test('new_public_methods_use_current_identity_and_reject_privileged_or_extra_parameters', async () => {
  const f = fixture();
  await f.entry.create.call(f.context, { requestId: 'cloud-create-000001', name: '家' });
  const response = await f.entry.invite.call(f.context, { requestId: 'cloud-invite-000001' }) as { data: { invitationId: string; token: string } };
  expect(response.data.token).toMatch(/^v1\.test\./);
  expect(JSON.stringify([...f.rows.values()])).not.toContain(response.data.token);
  expect(await f.entry.invite.call(f.context, { requestId: 'cloud-invite-000002', role: 'owner' })).toEqual({ errCode: 'INVALID_INPUT' });
  expect(await f.entry.invite.call(f.context, { requestId: 'cloud-invite-000002' }, 'extra')).toEqual({ errCode: 'INVALID_INPUT' });
  expect(await f.entry.members.call(f.context, { familyId: 'other' })).toEqual({ errCode: 'INVALID_INPUT' });
  expect(await f.entry.revokeInvite.call(f.context, { requestId: 'cloud-revoke-000001', invitationId: response.data.invitationId })).toMatchObject({ errCode: 0, data: null });
  f.revoke();
  for (const method of ['invite', 'revokeInvite', 'join', 'invitations', 'leave', 'removeMember', 'transferOwner'] as const) expect(await f.entry[method].call(f.context, {})).toEqual({ errCode: 'AUTH_REQUIRED' });
});

test('membership_cloud_methods_use_verified_actor_and_replay_transfer_before_role_checks', async () => {
  const f = fixture('void');
  const created = await f.entry.create.call(f.context, { requestId: 'cloud-membership-create', name: '家' }) as { data: { familyId: string; generation: string } };
  const { familyId, generation } = created.data;
  const owner = f.rows.get('family_members/alice')!;
  f.rows.set('family_members/bob', { ...owner, _id: 'bob', role: 'member', generation: 'bob-generation' });
  const input = { requestId: 'cloud-membership-transfer', familyId, generation, uid: 'bob', targetGeneration: 'bob-generation' };
  for (const method of ['leave', 'removeMember', 'transferOwner'] as const) {
    expect(await f.entry[method].call(f.context, { ...input, ownerUid: 'forged' })).toEqual({ errCode: 'INVALID_INPUT' });
    expect(await f.entry[method].call(f.context, input, {})).toEqual({ errCode: 'INVALID_INPUT' });
  }
  const reply = await f.entry.transferOwner.call(f.context, input) as { data: { uid: string; generation: string }; newToken: unknown };
  expect(reply).toMatchObject({ errCode: 0, data: { uid: 'alice', familyId, role: 'member' }, newToken: { token: 'renewed-token' } });
  expect(reply.data.generation).not.toBe(generation);
  expect(await f.entry.transferOwner.call(f.context, input)).toMatchObject({ errCode: 0, data: reply.data });
  expect(await f.entry.leave.call(f.context, { requestId: 'cloud-membership-leave', familyId, generation: reply.data.generation })).toMatchObject({ errCode: 0, data: null });
  expect(f.rows.has('family_members/alice')).toBe(false); expect(f.rows.get(`families/${familyId}`)?.ownerUid).toBe('bob');
});

test('authenticated_family_current_returns_no_membership_after_successful_alipay_void_commits', async () => {
  const f = fixture('void'); const boundary = createSessionBoundary(createMemoryStorage());
  const cloud = createCloudClient({ boundary, transport: async (object, method, input) => {
    expect(object).toBe('family-co'); expect(method).toBe('current');
    return f.entry.current.apply(f.context, JSON.parse(JSON.stringify([input])) as unknown[]);
  } });
  const family = createFamilyApi({ boundary, invoke: cloud.invoke });
  expect(await family.current()).toBeNull();
  // The real service commits its persistent UID quota and membership-read transaction.
  expect(f.transactions).toBe(2); expect(f.commits).toBe(2); expect(f.rollbacks).toBe(0);
  const limits = [...f.rows].filter(([key]) => key.startsWith('request_limits/')).map(([, value]) => value);
  expect(limits).toEqual([expect.objectContaining({ subject: 'uid:alice', operation: 'family:current', count: 1 })]);
  expect(f.rows.size).toBe(1); expect(f.contentCalls).toHaveLength(0);
});

test.each([undefined, null, {}])('current_accepts_empty_input_through_invoke_and_serialized_production_call_%j', async input => {
  const f = fixture(); const storage = createMemoryStorage(); const boundary = createSessionBoundary(storage);
  const parameters: unknown[][] = []; const responses: unknown[] = [];
  const api: Record<string, (...params: unknown[]) => Promise<unknown>> = {
    async current(...params) {
      // importObject retains the single input; JSON represents [undefined] as [null].
      const serialized = JSON.parse(JSON.stringify(params)) as unknown[]; parameters.push(serialized);
      const response = await f.entry.current.apply(f.context, serialized); responses.push(response); return response;
    },
  };
  const cloud = createCloudClient({ boundary, transport: async (object, method, value) => {
    expect(object).toBe('family-co'); return api[method](value); // Existing production transport shape.
  } });
  expect(await cloud.invoke('family-co', 'current', input)).toBeNull();
  expect(parameters).toEqual([[input === undefined ? null : input]]);
  expect(responses[0]).toEqual({ errCode: 0, data: null, newToken: { token: 'renewed-token', tokenExpired: expect.any(Number) } });
  // The same empty representation remains accepted before transport serialization.
  expect(await f.entry.current.call(f.context, input)).toMatchObject({ errCode: 0, data: null });
  const created = await f.entry.create.call(f.context, { requestId: 'request_1234567890', name: '我家' }) as { data: unknown };
  expect(await cloud.invoke('family-co', 'current', input)).toEqual(created.data);
  expect(responses[1]).toEqual({ errCode: 0, data: created.data, newToken: { token: 'renewed-token', tokenExpired: expect.any(Number) } });
});

test('current_rejects_serialized_nonempty_values_and_extra_parameters_without_business_reads', async () => {
  const f = fixture();
  for (const args of [[[]], [[{}]], [{ uid: 'forged' }], [{ role: 'owner' }], [{ unknown: true }], [''], ['forged'], [0], [false], [true], [{}, undefined], [undefined, undefined], [null, {}]]) {
    const serialized = JSON.parse(JSON.stringify(args)) as unknown[];
    expect(await f.entry.current.apply(f.context, serialized)).toEqual({ errCode: 'INVALID_INPUT' });
  }
  expect(f.transactions).toBe(0); expect(f.contentCalls).toHaveLength(0);
});
test('create_and_replay_use_verified_uid_real_service_and_only_top_level_refresh', async () => {
  const f = fixture(); const input = { requestId: 'request_1234567890', name: ' 我家 ' };
  const created = await f.entry.create.call(f.context, input) as { errCode: number; data: Record<string, unknown>; newToken: unknown };
  expect(created).toEqual({ errCode: 0, data: { uid: 'alice', familyId: expect.stringMatching(/^[a-f0-9]{32}$/), role: 'owner', generation: expect.stringMatching(/^[a-f0-9]{32}$/), name: '我家' }, newToken: { token: 'renewed-token', tokenExpired: expect.any(Number) } });
  expect(f.contentCalls).toEqual([{ content: '我家', openid: 'server-openid', version: 2, scene: 1 }]);
  expect(f.contexts).toEqual([{ provider: 'mp-weixin', appId: '__UNI__5FDC0D7', requestId: 'platform-request' }]);
  expect(f.reads.every(uid => uid === 'alice')).toBe(true);
  expect(f.checks.slice(0, 3)).toEqual([{ token: 'verified-token', autoRefresh: false }, { token: 'verified-token', autoRefresh: true }, { token: 'verified-token', autoRefresh: false }]);
  const replay = await f.entry.create.call(f.context, input) as { data: unknown }; expect(replay.data).toEqual(created.data); expect(f.contentCalls).toHaveLength(1);
  expect(await f.entry.current.call(f.context)).toEqual({ errCode: 0, data: created.data, newToken: { token: 'renewed-token', tokenExpired: expect.any(Number) } });
});
test('platform_and_token_rejection_happen_before_database_or_content', async () => {
  for (const override of [{ getUniIdToken: () => undefined }, { getUniIdToken: () => 'forged' }, { getClientInfo: () => ({ appId: 'forged', uniPlatform: 'mp-weixin' }) }, { getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'h5' }) }]) {
    const f = fixture(); const context = { ...f.context, ...override };
    expect(await f.entry.create.call(context, { requestId: 'request_1234567890', name: '我家' })).toEqual({ errCode: 'AUTH_REQUIRED' });
    expect(f.transactions).toBe(0); expect(f.contentCalls).toHaveLength(0);
  }
});
test('spoofed_fields_and_current_arguments_are_invalid_without_audit', async () => {
  const f = fixture();
  for (const field of ['uid', 'openid', 'familyId', 'role', 'generation', 'fault']) expect(await f.entry.create.call(f.context, { requestId: 'request_1234567890', name: '我家', [field]: 'forged' })).toEqual({ errCode: 'INVALID_INPUT' });
  expect(await f.entry.current.call(f.context, { uid: 'forged' })).toEqual({ errCode: 'INVALID_INPUT' }); expect(f.contentCalls).toHaveLength(0);
});
test('known_business_errors_remain_distinct_and_failure_responses_never_refresh', async () => {
  const f = fixture(); const input = { requestId: 'request_1234567890', name: '我家' };
  await f.entry.create.call(f.context, input);
  expect(await f.entry.create.call(f.context, { ...input, name: '别家' })).toEqual({ errCode: 'CONFLICT' });
  expect(await f.entry.create.call(f.context, { ...input, requestId: 'different_1234567890' })).toEqual({ errCode: 'ALREADY_IN_FAMILY' });
});
test('risk_and_unknown_content_errors_preserve_domain_failure_and_do_not_create', async () => {
  for (const [status, expected] of [['uni-sec-check-risk-content', 'INVALID_INPUT'], ['unknown', 'UNAVAILABLE']]) {
    const f = fixture(); f.setContent({ errCode: status, errMsg: '', result: { suggest: 'risky', label: '其他' } });
    expect(await f.entry.create.call(f.context, { requestId: 'request_1234567890', name: '我家' })).toEqual({ errCode: expected });
    expect(await f.entry.current.call(f.context)).toMatchObject({ errCode: 0, data: null });
  }
});
test('identity_revoked_during_audit_returns_auth_required_and_no_family', async () => {
  const f = fixture(); f.afterContent(() => f.revoke());
  expect(await f.entry.create.call(f.context, { requestId: 'request_1234567890', name: '我家' })).toEqual({ errCode: 'AUTH_REQUIRED' });
  f.restore(); expect(await f.entry.current.call(f.context)).toMatchObject({ errCode: 0, data: null });
});
