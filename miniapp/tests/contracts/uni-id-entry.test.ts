import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { assembleUniId } from '../../scripts/assemble-uni-id.mjs';
import { testDirectory } from '../support/temp-directory';
const require = createRequire(import.meta.url);
const { createEntry } = require('../../cloud-policies/uni-id-entry.cjs') as { createEntry: (deps: object) => Record<string, (...args: unknown[]) => Promise<unknown>> };
const { beforeRegister } = require('../../cloud-policies/before-register.cjs') as { beforeRegister: (input: object) => Promise<Record<string, unknown>> };
test('only_official_weixin_login_and_logout_are_public', () => {
  const entry = createEntry({});
  expect(Object.keys(entry).filter(key => !key.startsWith('_')).sort()).toEqual(['loginByWeixin', 'logout']);
});
test('rejects_non_code_fields_and_oversized_code', async () => {
  let calls = 0;
  const entry = createEntry({ upstream: { async loginByWeixin() { calls++; } } });
  for (const input of [{ code: '' }, { code: 'x'.repeat(1025) }, { code: 'code', uid: 'admin' }, { code: 'code', role: ['admin'] }, { code: 'code', inviteCode: 'other' }]) {
    await expect(entry.loginByWeixin.call({}, input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  expect(calls).toBe(0);
});
test('logout_does_not_refresh_near_threshold_using_pinned_auth_middleware', async () => {
  const targetPath = await testDirectory('pinned-auth-');
  await assembleUniId({ archivePath: resolve('vendor/uni-id/upstream.zip'), lockPath: resolve('vendor/uni-id/lock.json'), targetPath });
  const auth = require(resolve(targetPath, 'uniCloud-alipay/cloudfunctions/uni-id-co/upstream/middleware/auth.js'));
  let refreshCalls = 0; const removals: string[] = [];
  const libModule = { exports: {} };
  runInNewContext(await readFile(resolve(targetPath, 'uniCloud-alipay/cloudfunctions/uni-id-co/upstream/lib/utils/logout.js'), 'utf8'), {
    module: libModule,
    require: (path: string) => {
      if (path !== '../../common/constants') throw new Error('Unexpected pinned logout dependency');
      return {
        dbCmd: { pull: (token: string) => { removals.push(token); return { syntheticPull: true }; } }, LOG_TYPE: { LOGOUT: 'logout' },
        userCollection: { doc: () => ({ update: async () => ({}) }) }, deviceCollection: { where: () => ({ update: async () => ({}) }) },
      };
    },
  });
  const officialLogout = (libModule.exports as { logout: (this: object) => Promise<unknown> }).logout;
  const context = {
    getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' }), getMethodName: () => 'logout',
    getUniIdToken: () => 'fixture-token', getUniversalUniIdToken: () => 'fixture-token', getParams: () => [], response: {},
    getUniversalClientInfo: () => ({ deviceId: 'fixture-device' }), middleware: { async uniIdLog() {} },
    uniIdCommon: { async checkToken(_token: string, options?: { autoRefresh?: boolean }) {
      if (options?.autoRefresh !== false) refreshCalls++;
      return { errCode: 0, uid: 'alice' };
    } },
  };
  const entry = createEntry({
    upstream: { async _before(this: object) { await auth.call(this); }, async logout(this: object) { return officialLogout.call(this); } },
    async requireIdentity(_token: string, _info: object, options: object) { expect(options).toEqual({ refresh: false }); return { uid: 'alice' }; },
    limiter: { consume() { throw new Error('Logout must not use login limit'); } },
  });
  await entry._before.call(context);
  const result = await entry.logout.call(context);
  expect(entry._after.call(context, null, result)).not.toHaveProperty('newToken');
  expect(refreshCalls).toBe(0); expect(removals).toEqual(['fixture-token']);
});
test('before_register_rejects_empty_or_non_weixin_source_and_privileged_fields', async () => {
  const clientInfo = { appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' };
  for (const userRecord of [{ wx_openid: {} }, { wx_openid: { app: 'not-mini-program' } }, { wx_openid: { mp: 'fixture' }, password: 'synthetic' }, { wx_openid: { mp: 'fixture' }, role: ['admin'] }]) {
    await expect(beforeRegister({ clientInfo, userRecord })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  expect(await beforeRegister({ clientInfo, userRecord: { wx_openid: { mp: 'fixture' }, status: 4 } })).toEqual({ wx_openid: { mp: 'fixture' }, status: 0, role: [] });
});
test('unknown_password_admin_and_close_account_methods_are_rejected_before_upstream', async () => {
  let upstreamCalls = 0;
  const entry = createEntry({ upstream: { async _before() { upstreamCalls++; } } });
  for (const method of ['registerAdmin', 'login', 'registerUser', 'closeAccount', 'refreshToken', 'getTempFileURL', 'unknown']) {
    const context = { getMethodName: () => method, getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' }) };
    await expect(entry._before.call(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(entry).not.toHaveProperty(method);
  }
  expect(upstreamCalls).toBe(0);
});
