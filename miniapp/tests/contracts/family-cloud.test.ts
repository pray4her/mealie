import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { createCloudClient } from '../../src/shared/cloud-client';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage } from '../support/sdk-transport';
import { createFamilyApi } from '../../src/features/family/api';
const realRequire = createRequire(import.meta.url);

function fixture(commitAcknowledgement: 'object' | 'void' = 'object') {
  const rows = new Map<string, Record<string, unknown>>();
  const checks: { token: string; autoRefresh: boolean }[] = [];
  const contentCalls: unknown[] = []; const contexts: unknown[] = []; const reads: string[] = [];
  let active = true; let contentResult: unknown = { errCode: 0, errMsg: '', result: { suggest: 'pass', label: '正常' } };
  let afterContent = () => {}; let transactions = 0; let commits = 0; let rollbacks = 0; let sdkImports = 0;
  const key = (collection: string, id: string) => collection + '/' + id;
  const database = {
    collection(collection: string) { return { doc(id: string) { return { field() { return { async get() {
      reads.push(id);
      return { data: collection === 'uni-id-users' && id === 'alice' ? [{ status: active ? 0 : 1, token: ['verified-token'], wx_openid: { mp___UNI__5FDC0D7: 'server-openid' } }] : [] };
    } }; } }; } }; },
    async startTransaction() {
      transactions++; const staged = new Map(rows);
      return {
        collection(collection: string) { return {
          doc(id: string) { return { async get() { return { data: staged.get(key(collection, id)) ?? null }; },
            async update(value: object) { const k = key(collection, id); if (!staged.has(k)) return { updated: 0 }; staged.set(k, { ...staged.get(k), ...value }); return { updated: 1 }; },
            async remove() { return { deleted: staged.delete(key(collection, id)) ? 1 : 0 }; } }; },
          async add(value: Record<string, unknown>) { const id = String(value._id); if (staged.has(key(collection, id))) throw new Error('fixture duplicate'); staged.set(key(collection, id), value); return { id }; },
        }; },
        async commit() { commits++; rows.clear(); for (const [key, value] of staged) rows.set(key, value); if (commitAcknowledgement === 'object') return {}; },
        async rollback() { rollbacks++; return {}; },
      };
    },
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path)!.exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { module, exports: module.exports, Buffer, setTimeout, clearTimeout, process: { env: { FAMILY_INVITATION_KEY_VERSION: 'test', FAMILY_INVITATION_KEYS: JSON.stringify({ test: '01'.repeat(32) }) } }, uniCloud: { database: () => database }, require: (name: string) => {
      if (name === 'uni-id-common') { sdkImports++; return { createInstance: () => ({ async checkToken(token: string, options: { autoRefresh: boolean }) {
        checks.push({ token, ...options }); if (token !== 'verified-token') return { errCode: 'bad' };
        return { errCode: 0, uid: 'alice', iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 3600, ...(options.autoRefresh ? { token: 'renewed-token', tokenExpired: Date.now() + 3600000 } : {}) };
      } }) }; }
      if (name === 'uni-sec-check') { sdkImports++; return class { constructor(options: unknown) { contexts.push(options); } async textSecCheck(input: unknown) { contentCalls.push(input); afterContent(); return contentResult; } }; }
      if (name.startsWith('node:')) return realRequire(name);
      if (name.startsWith('home-')) return load(resolve('uniCloud-alipay/cloudfunctions/common', name, 'index.ts'));
      if (name.startsWith('.')) return load(resolve(dirname(path), name + '.ts'));
      throw new Error('Unexpected SDK dependency');
    } });
    return module.exports;
  }
  const entry = load(resolve('uniCloud-alipay/cloudfunctions/family-co/index.obj.ts')) as {
    current: (this: object, ...args: unknown[]) => Promise<unknown>;
    create: (this: object, input: unknown) => Promise<unknown>;
    invite: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    revokeInvite: (this: object, input: unknown) => Promise<unknown>;
    join: (this: object, input: unknown) => Promise<unknown>;
    members: (this: object, ...args: unknown[]) => Promise<unknown>;
    invitations: (this: object, input: unknown) => Promise<unknown>;
  };
  const context = { getUniIdToken: () => 'verified-token', getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' }), getUniCloudRequestId: () => 'platform-request' };
  return { entry, context, checks, contentCalls, contexts, reads, rows, get transactions() { return transactions; }, get commits() { return commits; }, get rollbacks() { return rollbacks; }, get sdkImports() { return sdkImports; }, revoke() { active = false; }, restore() { active = true; }, setContent(value: unknown) { contentResult = value; }, afterContent(fn: () => void) { afterContent = fn; } };
}

test('real_public_exports_are_lazy_and_current_has_only_safe_dto_and_top_level_token', async () => {
  const f = fixture(); expect(Object.keys(f.entry).sort()).toEqual(['create', 'current', 'invitations', 'invite', 'join', 'members', 'revokeInvite']); expect(f.sdkImports).toBe(0); expect(f.transactions).toBe(0);
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
  for (const method of ['invite', 'revokeInvite', 'join', 'invitations'] as const) expect(await f.entry[method].call(f.context, {})).toEqual({ errCode: 'AUTH_REQUIRED' });
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
