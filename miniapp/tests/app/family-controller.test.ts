import { afterEach, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createFamilyIntentStore, newRequestId } from '../../src/features/family/intents';
import { createMemoryStorage } from '../support/sdk-transport';
import { deferCall } from '../support/sdk-transport';
import { createFamilyController } from '../../src/features/family/use-family';
import { createAuthController } from '../../src/features/auth/use-auth';
import { createHarness } from '../support/harness';
import { AppError } from '../../src/shared/errors';

const controllers: { dispose(): void }[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
async function setup(random?: () => Promise<string>) {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' });
  const account = h.client('alice').account; const api = h.family('alice'); const auth = createAuthController(account);
  const storage = createMemoryStorage(); const intents = createFamilyIntentStore(storage);
  let ids = 0;
  const controller = createFamilyController({ api, auth, account, intents, newRequestId: random ?? (async () => `request-${String(++ids).padStart(16, '0')}`) });
  controllers.push(controller); return { h, account, api, auth, intents, storage, controller };
}

afterEach(() => { vi.unstubAllGlobals(); });
test('intent_storage_survives_restart_and_is_isolated_by_unambiguous_uid_keys', () => {
  const storage = createMemoryStorage(); const intents = createFamilyIntentStore(storage);
  const pending = { requestId: 'request-000000001', name: '家', uncertain: true };
  intents.write('alice:/家', pending);
  expect(createFamilyIntentStore(storage).read('alice:/家')).toEqual(pending);
  expect(intents.read('bob')).toBeNull(); intents.clear('alice:/家'); expect(intents.read('alice:/家')).toBeNull();
});
test('double_submit_while_random_id_pending_shares_one_intent', async () => {
  const random = deferCall(); let calls = 0;
  const { controller } = await setup(async () => { calls++; await random.promise; return 'random-request-0001'; }); await controller.load();
  const first = controller.submit('家'); const second = controller.submit('家');
  expect(first).toBe(second); await Promise.resolve(); expect(calls).toBe(1);
  random.resolve(null); expect(await first).toMatchObject({ name: '家' });
});
test('logout_during_random_id_generation_prevents_persist_and_send', async () => {
  const random = deferCall();
  const { controller, auth, intents, api } = await setup(async () => { await random.promise; return 'random-request-0001'; }); await controller.load();
  let sends = 0; api.create = async () => { sends++; throw new Error('must not send'); };
  const pending = controller.submit('家'); const result = expect(pending).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  await Promise.resolve(); await auth.signOut(); random.resolve(null); await result;
  expect(sends).toBe(0); expect(intents.read('alice')).toBeNull(); expect(controller.pending.value).toBeNull(); expect(controller.view.value).toBeNull();
});
test('harness_logout_synchronously_conceals_family_and_draft_and_ignores_late_create', async () => {
  const { controller, auth, api, intents } = await setup(); await controller.load();
  const family = await api.create({ requestId: 'other-device-000001', name: '家' }); await controller.load();
  expect(controller.view.value).toEqual(family);
  const response = deferCall(); api.create = async () => { await response.promise; return family; };
  const pending = controller.submit('家'); const result = expect(pending).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const logout = auth.signOut(); expect(controller.view.value).toBeNull(); expect(controller.pending.value).toBeNull(); expect(intents.read('alice')).toBeNull();
  response.resolve(null); await logout; await result;
  expect(controller.view.value).toBeNull(); expect(controller.phase.value).toBe('idle');
});
test.each([
  {}, [], 'bad', { requestId: 'short', name: '家', uncertain: true },
  { requestId: 'request-000000001', name: '家', uncertain: 'yes' },
  { requestId: 'request-000000001', name: '家 ', uncertain: true },
  { requestId: 'request-000000001', name: '家', uncertain: true, uid: 'bob' },
])('corrupt_intent_fails_closed: %j', raw => {
  const values = new Map<string, unknown>();
  const intents = createFamilyIntentStore({ get: () => raw, set: (key, value) => { values.set(key, value); }, remove() {} });
  expect(() => intents.read('alice')).toThrowError('UNAVAILABLE');
});
test('wechat_random_id_waits_for_the_actual_callback_and_encodes_all_sixteen_bytes', async () => {
  let complete!: (result: { randomValues: ArrayBuffer; errMsg: string }) => void;
  vi.stubGlobal('wx', { getRandomValues(options: { length: number; success: typeof complete }) { expect(options.length).toBe(16); complete = options.success; } });
  let resolved = false; const pending = newRequestId().then(id => { resolved = true; return id; });
  await Promise.resolve(); expect(resolved).toBe(false);
  complete({ randomValues: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 248, 249, 250, 251, 252, 253, 254, 255]).buffer, errMsg: 'getRandomValues:ok' });
  expect(await pending).toBe('0001020304050607f8f9fafbfcfdfeff');
});

test('wechat_random_id_accepts_a_real_array_buffer_from_another_javascript_context', async () => {
  const buffer: ArrayBuffer = runInNewContext('Uint8Array.from([0,1,2,3,4,5,6,7,248,249,250,251,252,253,254,255]).buffer');
  expect(buffer instanceof ArrayBuffer).toBe(false);
  vi.stubGlobal('wx', { getRandomValues(options: { success(result: { randomValues: ArrayBuffer }): void }) {
    options.success({ randomValues: buffer });
  } });
  await expect(newRequestId()).resolves.toBe('0001020304050607f8f9fafbfcfdfeff');
});

test.each([
  ['spoofed-buffer', { byteLength: 16, [Symbol.toStringTag]: 'ArrayBuffer' }],
  ['typed-array', new Uint8Array(16)],
  ['shared-buffer', new SharedArrayBuffer(16)],
  ['short-foreign-buffer', runInNewContext('new ArrayBuffer(15)')],
])('wechat_random_rejects_%s_without_a_weak_fallback', async (_name, buffer) => {
  vi.stubGlobal('wx', { getRandomValues(options: { success(result: unknown): void }) {
    options.success({ randomValues: buffer });
  } });
  await expect(newRequestId()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test('wechat_random_callback_errors_reject_instead_of_escaping_or_leaving_an_unresolved_request', async () => {
  let complete!: (result: unknown) => void;
  vi.stubGlobal('wx', { getRandomValues(options: { success(result: unknown): void }) { complete = options.success; } });
  const pending = newRequestId();
  const malformed = Object.defineProperty({}, 'randomValues', { get() { throw new Error('bridge conversion failed'); } });
  expect(() => complete(malformed)).not.toThrow();
  await expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test('load_confirms_identity_before_current_and_only_server_null_enables_creation', async () => {
  const { controller, auth } = await setup();
  expect(controller.phase.value).toBe('idle');
  expect(await controller.load()).toBeNull(); expect(auth.identity.value).toEqual({ uid: 'alice' });
  expect(controller.phase.value).toBe('ready'); expect(controller.view.value).toBeNull();
});
test('persist_before_first_send_and_success_clears_the_original_intent', async () => {
  const { controller, api, intents } = await setup(); await controller.load();
  const create = api.create;
  api.create = async input => {
    expect(intents.read('alice')).toEqual({ ...input, uncertain: true }); return create(input);
  };
  const family = await controller.submit('  家  ');
  expect(family.name).toBe('家'); expect(controller.view.value).toEqual(family);
  expect(intents.read('alice')).toBeNull(); expect(controller.pending.value).toBeNull();
});
test('unknown_result_blocks_new_name_and_retry_replays_the_same_request', async () => {
  const { controller, api } = await setup(); await controller.load(); const create = api.create;
  const sent: unknown[] = [];
  api.create = async input => { sent.push(input); if (sent.length === 1) throw new Error('network'); return create(input); };
  await expect(controller.submit('原名称')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(controller.phase.value).toBe('unavailable');
  expect(await controller.submit('新名称')).toMatchObject({ name: '原名称' });
  expect(sent).toEqual([{ requestId: 'request-0000000000000001', name: '原名称' }, { requestId: 'request-0000000000000001', name: '原名称' }]);
});
test('known_validation_rejection_allows_a_new_intent_but_later_rejection_cannot_erase_unknown', async () => {
  const { controller, api, intents } = await setup(); await controller.load();
  api.create = async () => { throw new AppError('INVALID_INPUT'); };
  await expect(controller.submit('被拒绝')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(intents.read('alice')).toBeNull(); expect(controller.pending.value).toBeNull();
  expect(controller.phase.value).toBe('ready');
  api.create = async () => { throw new AppError('UNAVAILABLE'); };
  await expect(controller.submit('未确认')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const original = intents.read('alice'); expect(original?.requestId).toBe('request-0000000000000002');
  api.create = async () => { throw new AppError('INVALID_INPUT'); };
  await expect(controller.retry()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(intents.read('alice')).toEqual(original); expect(controller.pending.value).toEqual(original);
});
test.each(['current-unavailable', 'signed-in-only'] as const)('first_validation_rejection_cannot_confirm_no_family_after_%s', async state => {
  const { controller, api, auth, intents } = await setup(); let currentCalls = 0;
  api.current = async () => { currentCalls++; throw new AppError('UNAVAILABLE'); };
  if (state === 'current-unavailable') {
    await expect(controller.load()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(controller.phase.value).toBe('unavailable');
  } else {
    await auth.signIn(); expect(controller.phase.value).toBe('idle');
  }
  api.create = async () => { throw new AppError('INVALID_INPUT'); };
  await expect(controller.submit('被拒绝')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(auth.phase.value).toBe('authenticated'); expect(controller.view.value).toBeNull();
  expect(controller.phase.value).toBe('unavailable');
  expect(controller.pending.value).toBeNull(); expect(intents.read('alice')).toBeNull();
  expect(currentCalls).toBe(state === 'current-unavailable' ? 1 : 0);
});
test('cold_start_null_current_keeps_the_original_intent_and_nonnull_current_restores_membership', async () => {
  const { controller, intents, api } = await setup();
  const original = { requestId: 'original-request-001', name: '原名称', uncertain: true };
  intents.write('alice', original); await controller.load();
  expect(controller.pending.value).toEqual(original);
  const family = await api.create({ requestId: original.requestId, name: original.name });
  expect(await controller.load()).toEqual(family); expect(controller.pending.value).toBeNull(); expect(intents.read('alice')).toBeNull();
});
test('query_network_failure_hides_old_view_without_erasing_draft_or_claiming_no_family', async () => {
  const { controller, api, intents } = await setup(); await controller.load();
  const family = await controller.submit('家'); expect(controller.view.value).toEqual(family);
  const draft = { requestId: 'unknown-request-0001', name: '旧名称', uncertain: true }; intents.write('alice', draft);
  api.current = async () => { throw new Error('network'); };
  await expect(controller.load()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(controller.view.value).toBeNull(); expect(controller.phase.value).toBe('unavailable'); expect(intents.read('alice')).toEqual(draft);
});
test('clear_invalidates_late_load_and_keeps_unknown_intent_for_the_next_show', async () => {
  const { controller, api, intents } = await setup(); await controller.load();
  const draft = { requestId: 'unknown-request-0001', name: '原名称', uncertain: true }; intents.write('alice', draft);
  const response = deferCall(); const family = { uid: 'alice', familyId: 'family-1', generation: 'generation-1', role: 'owner' as const, name: '家' };
  api.current = async () => { await response.promise; return family; };
  const load = controller.load(); for (let i = 0; i < 10; i++) await Promise.resolve(); controller.clear();
  response.resolve(null); expect(await load).toBeNull();
  expect(controller.view.value).toBeNull(); expect(controller.phase.value).toBe('idle'); expect(intents.read('alice')).toEqual(draft);
});
test('already_in_family_recovers_current_instead_of_claiming_creation_failure', async () => {
  const { controller, api, intents } = await setup(); await controller.load();
  const family = await api.create({ requestId: 'other-device-000001', name: '已存在' });
  expect(await controller.submit('未创建')).toEqual(family); expect(controller.view.value).toEqual(family); expect(intents.read('alice')).toBeNull();
});
test('storage_write_failure_and_random_failure_prevent_network_send', async () => {
  const { controller, storage, api } = await setup(); await controller.load(); let sends = 0;
  api.create = async () => { sends++; throw new Error('must not send'); }; storage.set = () => { throw new Error('disk'); };
  await expect(controller.submit('家')).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(sends).toBe(0);
  const failing = await setup(async () => { throw new Error('random failed'); }); await failing.controller.load();
  failing.api.create = api.create;
  await expect(failing.controller.submit('家')).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(sends).toBe(0); expect(failing.controller.phase.value).toBe('unavailable');
});
test('unknown_intent_survives_clear_and_query_failure_without_becoming_a_new_request', async () => {
  const { controller, api } = await setup(); await controller.load(); const sent: unknown[] = [];
  api.create = async input => { sent.push(input); throw new AppError('UNAVAILABLE'); };
  await expect(controller.submit('原名称')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  controller.clear(); api.current = async () => { throw new AppError('UNAVAILABLE'); };
  await expect(controller.load()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(controller.submit('新名称')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(sent).toEqual([{ requestId: 'request-0000000000000001', name: '原名称' }, { requestId: 'request-0000000000000001', name: '原名称' }]);
});
test('old_random_callback_cannot_disturb_the_new_accounts_single_flight_or_draft', async () => {
  const randomA = deferCall(); const randomB = deferCall(); let randomCalls = 0;
  const { controller, account, api, auth, intents, h } = await setup(async () => {
    const call = ++randomCalls; await (call === 1 ? randomA.promise : randomB.promise); return call === 1 ? 'alice-request-00001' : 'bob-request-0000001';
  });
  await controller.load(); const old = controller.submit('A名称'); const oldResult = expect(old).rejects.toMatchObject({ code: 'AUTH_REQUIRED' }); await Promise.resolve();
  await auth.signOut(); await h.seedIdentity({ uid: 'bob' });
  account.signInWeixin = h.client('bob').account.signInWeixin; account.session = h.client('bob').account.session;
  api.current = h.family('bob').current; api.create = h.family('bob').create;
  await auth.signIn(); await controller.load();
  const bob = controller.submit('B名称'); await Promise.resolve(); expect(randomCalls).toBe(2);
  randomA.resolve(null); await oldResult;
  expect(controller.submit('B名称')).toBe(bob); expect(intents.read('alice')).toBeNull(); expect(intents.read('bob')).toBeNull();
  randomB.resolve(null); expect(await bob).toMatchObject({ uid: 'bob', name: 'B名称' });
  expect(controller.view.value?.uid).toBe('bob'); expect(intents.read('alice')).toBeNull();
});
test.each(['current', 'create'] as const)('auth_required_from_%s_closes_even_a_plain_account_facade', async method => {
  const { controller, api, auth, intents } = await setup(); await controller.load();
  intents.write('alice', { requestId: 'unknown-request-0001', name: '家', uncertain: true });
  api[method] = async () => { throw new AppError('AUTH_REQUIRED'); };
  await expect(method === 'current' ? controller.load() : controller.submit('家')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(auth.identity.value).toBeNull(); expect(controller.view.value).toBeNull(); expect(intents.read('alice')).toBeNull();
});
test('temporary_identity_restore_failure_hides_content_but_preserves_last_trusted_draft', async () => {
  const { controller, account, intents } = await setup(); await controller.load();
  const draft = { requestId: 'unknown-request-0001', name: '原名称', uncertain: true }; intents.write('alice', draft);
  account.session = async () => { throw new AppError('UNAVAILABLE'); };
  expect(await controller.load()).toBeNull(); expect(controller.phase.value).toBe('unavailable'); expect(controller.view.value).toBeNull(); expect(intents.read('alice')).toEqual(draft);
});
test.each(['current', 'create'] as const)('a_%s_result_for_another_uid_never_becomes_visible', async method => {
  const { controller, api, intents } = await setup(); await controller.load();
  const wrong = { uid: 'bob', familyId: 'family-b', generation: 'generation-b', role: 'owner' as const, name: '别人的家' };
  api[method] = async () => wrong;
  await expect(method === 'current' ? controller.load() : controller.submit('家')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(controller.view.value).toBeNull();
  if (method === 'create') expect(intents.read('alice')?.uncertain).toBe(true);
});
test('corrupt_saved_intent_prevents_creation_instead_of_silently_replacing_it', async () => {
  const { controller, storage, api } = await setup();
  const intents = createFamilyIntentStore(storage); intents.write('alice', { requestId: 'unknown-request-0001', name: '家', uncertain: true });
  const get = storage.get; storage.get = key => key.startsWith('home.family.create.') ? { name: 'corrupt' } : get(key);
  let calls = 0; api.create = async () => { calls++; throw new Error('must not send'); };
  await expect(controller.load()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await expect(controller.submit('新名称')).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(calls).toBe(0); expect(controller.phase.value).toBe('unavailable');
});
test('an_older_load_cannot_overwrite_or_hide_a_newer_confirmed_family', async () => {
  const { controller, api } = await setup(); await controller.load();
  const response = deferCall(); const family = { uid: 'alice', familyId: 'family-1', generation: 'generation-1', role: 'owner' as const, name: '家' }; let calls = 0;
  api.current = async () => { if (++calls === 1) { await response.promise; throw new Error('old failure'); } return family; };
  const old = controller.load(); for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(await controller.load()).toEqual(family); response.resolve(null); expect(await old).toBeNull();
  expect(controller.view.value).toEqual(family); expect(controller.phase.value).toBe('ready');
});
test('conflict_retains_the_original_request_and_name', async () => {
  const { controller, api, intents } = await setup(); await controller.load();
  api.create = async () => { throw new AppError('CONFLICT'); };
  await expect(controller.submit('原名称')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(controller.phase.value).toBe('conflict'); expect(intents.read('alice')).toEqual({ requestId: 'request-0000000000000001', name: '原名称', uncertain: true });
});
test.each(['missing', 'throws', 'failure', 'malformed'] as const)('wechat_random_%s_fails_without_a_weak_fallback', async mode => {
  if (mode === 'missing') vi.stubGlobal('wx', {});
  else vi.stubGlobal('wx', { getRandomValues(options: { fail(): void; success(result: unknown): void }) {
    if (mode === 'throws') throw new Error('unsupported');
    if (mode === 'failure') options.fail(); else options.success({ randomValues: new ArrayBuffer(15) });
  } });
  await expect(newRequestId()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
test('dispose_releases_account_observers_and_stops_further_work', async () => {
  const { controller, auth, api, intents } = await setup(); await controller.load();
  const draft = { requestId: 'unknown-request-0001', name: '家', uncertain: true }; intents.write('alice', draft);
  controller.dispose(); await auth.signOut(); expect(intents.read('alice')).toEqual(draft);
  let calls = 0; api.current = async () => { calls++; return null; };
  await expect(controller.load()).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(calls).toBe(0);
});
