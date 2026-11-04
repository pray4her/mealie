import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { checkBoundaries } from '../../scripts/check-boundaries.mjs';
import { assembleUniId } from '../../scripts/assemble-uni-id.mjs';
import { checkSecrets } from '../../scripts/check-secrets.mjs';
import { doctor } from '../../scripts/doctor.mjs';
import { testDirectory } from '../support/temp-directory';
async function fixture() {
  const dir = await testDirectory('boundary-');
  await assembleUniId({ archivePath: resolve('vendor/uni-id/upstream.zip'), lockPath: resolve('vendor/uni-id/lock.json'), targetPath: dir });
  const account = join(dir, 'uniCloud-alipay/cloudfunctions/account-co'); await mkdir(account, { recursive: true });
  await writeFile(join(account, 'index.obj.ts'), 'export async function session() {}');
  await writeFile(join(account, 'package.json'), '{"name":"account-co","private":true}');
  return dir;
}
test('unique_discoverable_identity_object', async () => {
  const dir = await fixture(); await expect(checkBoundaries({ root: dir })).resolves.toBeUndefined();
  const duplicate = join(dir, 'src/uni_modules/rogue/uniCloud/cloudfunctions/uni-id-co'); await mkdir(duplicate, { recursive: true });
  await writeFile(join(duplicate, 'index.obj.js'), 'module.exports={}');
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/duplicate|unique/i);
});
test('identity_clientdb_permissions_are_closed', async () => {
  const dir = await fixture(); const schemaPath = join(dir, 'src/uni_modules/uni-id-pages/uniCloud/database/uni-id-users.schema.json');
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')); expect(schema.permission).toEqual({ read: false, create: false, update: false, delete: false });
  schema.permission.read = true; await writeFile(schemaPath, JSON.stringify(schema));
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/permission/i);
});
test('client_cannot_import_runtime_cloud_modules', async () => {
  const dir = await fixture(); await writeFile(join(dir, 'src/escape.ts'), "import { createRequireIdentity } from 'home-kernel';");
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/client|runtime/i);
});
test('dynamic_require_and_value_contract_imports_are_rejected', async () => {
  const dir = await fixture();
  for (const source of ["const cloud = import('home-kernel');", "const cloud = require('../uniCloud-alipay/cloudfunctions/common/home-kernel');", "import { Identity } from 'home-contracts';", "import '../vendor/source';", "import x from './uni_modules/rogue/uniCloud/cloudfunctions/common/impl';"]) {
    await writeFile(join(dir, 'src/escape.ts'), source); await expect(checkBoundaries({ root: dir })).rejects.toThrow(/client|runtime/i);
  }
});
test('vendor_and_tests_must_not_enter_build_artifact', async () => {
  const dir = await fixture(); const dist = join(dir, 'dist/build/mp-weixin'); await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'app.js'), 'const leak="vendor/uni-id/upstream.zip";');
  await expect(checkBoundaries({ root: dir, artifacts: true })).rejects.toThrow(/artifact/i);
});
test('secret_fixture_is_rejected_without_echoing_value', async () => {
  const dir = await fixture(); const synthetic = 'SYNTHETIC-ONLY-DO-NOT-USE-0123456789';
  await writeFile(join(dir, 'src/leak.ts'), `const appsecret = '${synthetic}';`);
  try { await checkSecrets({ root: dir }); throw new Error('Scanner incorrectly accepted fixture'); }
  catch (error) { expect(String(error)).toMatch(/Secret detected/); expect(String(error)).not.toContain(synthetic); }
});
test('doctor_is_non_ready_without_real_cloud_device_and_target_evidence', async () => {
  const dir = await fixture(); const result = await doctor({ root: dir });
  expect(result.ready).toBe(false); expect(result.blockers).toEqual(expect.arrayContaining(['target-missing', 'cloud-runtime-unknown', 'cloud-region-unknown', 'existing-resources-unknown', 'cloud-acceptance-missing', 'device-acceptance-missing', 'secret-configuration-unverified']));
});
test('deployment_runtime_relative_imports_cannot_escape_package', async () => {
  const dir = await fixture(); const path = join(dir, 'uniCloud-alipay/cloudfunctions/uni-id-co/escape.js');
  await writeFile(path, "require('../../../cloud-policies/uni-id-entry.cjs');");
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/deployment|escape/i);
});
test('authored_cloud_dynamic_require_cannot_hide_dependency_escape', async () => {
  const dir = await fixture(); await writeFile(join(dir, 'uniCloud-alipay/cloudfunctions/uni-id-co/escape.js'), "const source='../../../cloud-policies/uni-id-entry.cjs'; require(source);");
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/deployment|dynamic/i);
});
test('only_three_actual_public_methods_are_deployable', async () => {
  const dir = await fixture(); const path = join(dir, 'uniCloud-alipay/cloudfunctions/account-co'); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'index.obj.ts'), 'export async function session() {}\nexport async function registerAdmin() {}');
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|export|method/i);
});
test('account_object_reexports_cannot_expand_public_surface', async () => {
  const dir = await fixture(); await writeFile(join(dir, 'uniCloud-alipay/cloudfunctions/account-co/index.obj.ts'), "export async function session() {}\nexport { registerAdmin } from './helper';");
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|export|method/i);
});
test('extra_plugin_cloud_object_is_rejected', async () => {
  const dir = await fixture(); const rogue = join(dir, 'src/uni_modules/rogue/uniCloud/cloudfunctions/admin-co'); await mkdir(rogue, { recursive: true });
  await writeFile(join(rogue, 'index.obj.js'), 'module.exports={registerAdmin(){}}');
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|object/i);
});
test('second_provider_root_is_rejected', async () => {
  const other = await fixture(); await mkdir(join(other, 'uniCloud-aliyun'), { recursive: true });
  await expect(checkBoundaries({ root: other })).rejects.toThrow(/root|provider/i);
});
