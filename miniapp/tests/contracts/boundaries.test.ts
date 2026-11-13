import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { checkBoundaries } from '../../scripts/check-boundaries.mjs';
import { assembleUniId } from '../../scripts/assemble-uni-id.mjs';
import { checkSecrets } from '../../scripts/check-secrets.mjs';
import { doctor } from '../../scripts/doctor.mjs';
import { testDirectory } from '../support/temp-directory';
const tabBar = { list: [{ pagePath: 'pages/recipes/index', text: '菜谱' }, { pagePath: 'pages/family/home', text: '家庭' }] };
async function fixture() {
  const dir = await testDirectory('boundary-');
  await assembleUniId({ archivePath: resolve('vendor/uni-id/upstream.zip'), lockPath: resolve('vendor/uni-id/lock.json'), targetPath: dir });
  const account = join(dir, 'uniCloud-alipay/cloudfunctions/account-co'); await mkdir(account, { recursive: true });
  await writeFile(join(account, 'index.obj.ts'), 'export async function session() {}');
  await writeFile(join(account, 'package.json'), '{"name":"account-co","private":true}');
  const family = join(dir, 'uniCloud-alipay/cloudfunctions/family-co'); await mkdir(family, { recursive: true });
  await writeFile(join(family, 'index.obj.ts'), 'export async function current() {}\nexport async function create() {}\nexport async function invite() {}\nexport async function revokeInvite() {}\nexport async function join() {}\nexport async function members() {}\nexport async function invitations() {}\nexport async function leave() {}\nexport async function removeMember() {}\nexport async function transferOwner() {}');
  await writeFile(join(family, 'package.json'), '{"name":"family-co","private":true}');
  for (const name of ['home-kernel', 'home-contracts']) {
    const common = join(dir, 'uniCloud-alipay/cloudfunctions/common', name); await mkdir(common, { recursive: true });
    await writeFile(join(common, 'package.json'), JSON.stringify({ name, private: true }));
  }
  const recipes = join(dir, 'uniCloud-alipay/cloudfunctions/recipes-co'); await mkdir(recipes, { recursive: true });
  await writeFile(join(recipes, 'index.obj.ts'), 'export async function create() {}\nexport async function get() {}\nexport async function list() {}\nexport async function update() {}\nexport async function favorite() {}\nexport async function bindImages() {}');
  await writeFile(join(recipes, 'package.json'), '{"name":"recipes-co","private":true}');
  const media = join(dir, 'uniCloud-alipay/cloudfunctions/media-co'); await mkdir(media, { recursive: true });
  await writeFile(join(media, 'index.obj.ts'), ['requestUpload', 'upload', 'complete', 'status', 'read'].map(method => 'export async function ' + method + '() {}').join('\n'));
  await writeFile(join(media, 'package.json'), '{"name":"media-co","private":true}');
  const callback = join(dir, 'uniCloud-alipay/cloudfunctions/media-review-callback'); await mkdir(callback, { recursive: true });
  await writeFile(join(callback, 'index.ts'), 'export async function main() {}');
  await writeFile(join(callback, 'package.json'), '{"name":"media-review-callback","private":true}');
  for (const [name, methods] of [['imports-co', ['submit', 'get', 'cancel']], ['import-worker', ['_timing']]] as const) {
    const folder = join(dir, 'uniCloud-alipay/cloudfunctions', name); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'index.obj.ts'), methods.map(method => 'export async function ' + method + '() {}').join('\n'));
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name, private: true }));
  }
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

test('import_worker_cannot_export_public_entrypoints_and_provider_keys_cannot_enter_client', async () => {
  const root = await fixture();
  await writeFile(join(root, 'uniCloud-alipay/cloudfunctions/import-worker/index.obj.ts'), 'export async function _timing() {}\nexport async function run() {}');
  await expect(checkBoundaries({ root })).rejects.toThrow(/method|export/);
  await writeFile(join(root, 'uniCloud-alipay/cloudfunctions/import-worker/index.obj.ts'), 'export async function _timing() {}');
  await writeFile(join(root, 'src/leak.ts'), "const key = process.env.OPENROUTER_API_KEY;");
  await expect(checkBoundaries({ root })).rejects.toThrow(/client|secret/i);
  await writeFile(join(root, 'src/leak.ts'), "const key = process.env.JINA_API_KEY;");
  await expect(checkBoundaries({ root })).rejects.toThrow(/client|secret/i);
  await writeFile(join(root, 'src/leak.ts'), "const flag = process.env.IMPORTS_URL_ENABLED;");
  await expect(checkBoundaries({ root })).rejects.toThrow(/client|secret/i);
});
test('dynamic_require_and_value_contract_imports_are_rejected', async () => {
  const dir = await fixture();
  for (const source of ["const cloud = import('home-kernel');", "const cloud = require('../uniCloud-alipay/cloudfunctions/common/home-kernel');", "import { Identity } from 'home-contracts';", "import '../vendor/source';", "import x from './uni_modules/rogue/uniCloud/cloudfunctions/common/impl';"]) {
    await writeFile(join(dir, 'src/escape.ts'), source); await expect(checkBoundaries({ root: dir })).rejects.toThrow(/client|runtime/i);
  }
});
test('vendor_and_tests_must_not_enter_build_artifact', async () => {
  const dir = await fixture(); const dist = join(dir, 'dist/build/mp-weixin'); await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'app.json'), JSON.stringify({ pages: ['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members', 'pages/recipes/index', 'pages/recipes/detail', 'pages/recipes/edit', 'pages/imports/submit', 'pages/imports/status'], tabBar }));
  await writeFile(join(dist, 'app.js'), 'const leak="vendor/uni-id/upstream.zip";');
  await expect(checkBoundaries({ root: dir, artifacts: true })).rejects.toThrow(/artifact/i);
});

test('artifact_routes_are_exactly_the_implemented_account_family_recipe_and_import_pages', async () => {
  const dir = await fixture(); const dist = join(dir, 'dist/build/mp-weixin'); await mkdir(dist, { recursive: true });
  const path = join(dist, 'app.json'); const pages = ['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members', 'pages/recipes/index', 'pages/recipes/detail', 'pages/recipes/edit', 'pages/imports/submit', 'pages/imports/status'];
  await writeFile(path, JSON.stringify({ pages, tabBar })); await expect(checkBoundaries({ root: dir, artifacts: true })).resolves.toBeUndefined();
  for (const manifest of [{ pages }, { pages: pages.slice(0, 2), tabBar }, { pages: [...pages, 'pages/family/invites'], tabBar }, { pages, tabBar, subPackages: [{ root: 'future', pages: ['invite'] }] }, { pages, tabBar: { list: [] } }, { pages, tabBar: { custom: true, ...tabBar } }, { pages, tabBar: { list: [...tabBar.list, { pagePath: 'pages/plans/index', text: '计划' }] } }, { pages, tabBar: { list: [tabBar.list[0], tabBar.list[0]] } }, { pages, tabBar: { list: [{ ...tabBar.list[0], pagePath: 'pages/recipes/index?id=1' }, tabBar.list[1]] } }]) {
    await writeFile(path, JSON.stringify(manifest)); await expect(checkBoundaries({ root: dir, artifacts: true })).rejects.toThrow(/artifact.*route/i);
  }
});

test('artifact_wxss_rejects_universal_selectors_before_wechat_compilation', async () => {
  const dir = await fixture(); const dist = join(dir, 'dist/build/mp-weixin'); await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'app.json'), JSON.stringify({ pages: ['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members', 'pages/recipes/index', 'pages/recipes/detail', 'pages/recipes/edit', 'pages/imports/submit', 'pages/imports/status'], tabBar }));
  const path = join(dist, 'app.wxss');
  for (const source of ['.actions > * { flex: 1; }', '@media (max-width: 359px) { * { margin: 0; } }', '.page :is(*) { color: red; }']) {
    await writeFile(path, source); await expect(checkBoundaries({ root: dir, artifacts: true })).rejects.toThrow(/WXSS.*universal/i);
  }
  await writeFile(path, '/* * comment */ .actions > .wd-button, [data-label=" *"], [class*="icon"] { flex: 1; } .label::after { content: "*"; width: calc(2 * 1px); }');
  await expect(checkBoundaries({ root: dir, artifacts: true })).resolves.toBeUndefined();
});

test('family_content_and_fixture_runtime_cannot_enter_actual_artifact_content', async () => {
  const dir = await fixture(); const dist = join(dir, 'dist/build/mp-weixin'); await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'app.json'), JSON.stringify({ pages: ['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members', 'pages/recipes/index', 'pages/recipes/detail', 'pages/recipes/edit', 'pages/imports/submit', 'pages/imports/status'], tabBar }));
  for (const forbidden of ['home-imports', 'home-media', 'home-recipes', 'home-family', 'home-kernel', 'uni-sec-check', 'uni-open-bridge', 'tests/support/harness', 'cloudfunctions/common', 'JINA_API_KEY']) {
    await writeFile(join(dist, 'app.js'), `const leaked = '${forbidden}';`);
    await expect(checkBoundaries({ root: dir, artifacts: true })).rejects.toThrow(/artifact/i);
  }
});

test('production_artifact_rejects_isolated_visual_review_data', async () => {
  const dir = await fixture(); const dist = join(dir, 'dist/build/mp-weixin'); await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'app.json'), JSON.stringify({ pages: ['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members', 'pages/recipes/index', 'pages/recipes/detail', 'pages/recipes/edit', 'pages/imports/submit', 'pages/imports/status'], tabBar }));
  for (const forbidden of ['HOME_UI_REVIEW_V11_ONLY', 'home.ui-review.v11', 'static/ui-review/noodles.jpg', 'ui-review-owner']) {
    await writeFile(join(dist, 'app.js'), `const leaked = '${forbidden}';`);
    await expect(checkBoundaries({ root: dir, artifacts: true })).rejects.toThrow(/review fixtures/i);
  }
});
test('secret_fixture_is_rejected_without_echoing_value', async () => {
  const dir = await fixture(); const synthetic = 'SYNTHETIC-ONLY-DO-NOT-USE-0123456789';
  await writeFile(join(dir, 'src/leak.ts'), `const appsecret = '${synthetic}';`);
  try { await checkSecrets({ root: dir }); throw new Error('Scanner incorrectly accepted fixture'); }
  catch (error) { expect(String(error)).toMatch(/Secret detected/); expect(String(error)).not.toContain(synthetic); }
});
test('official_error_enum_is_not_a_secret_but_real_secret_property_is_rejected', async () => {
  const dir = await fixture(); const path = join(dir, 'src/error.js');
  await writeFile(path, "const ErrorCode = { INVALID_APPSECRET: 'invalid-appsecret' }; module.exports = ErrorCode;");
  await expect(checkSecrets({ root: dir })).resolves.toBeUndefined();
  await writeFile(path, "const config = { appsecret: 'SYNTHETIC-ONLY-DO-NOT-USE-0123456789' };");
  await expect(checkSecrets({ root: dir })).rejects.toThrow(/Secret detected/);
  for (const name of ['appsecret', 'tokenSecret', 'passwordSecret', 'privateKey', 'apiKey', 'WEIXIN_APPSECRET', 'INVALID_APPSECRET']) {
    for (const source of [`const config = { '${name}': 'SYNTHETIC-ONLY-DO-NOT-USE-0123456789' };`, `config.${name} = 'SYNTHETIC-ONLY-DO-NOT-USE-0123456789';`]) {
      await writeFile(path, source); await expect(checkSecrets({ root: dir })).rejects.toThrow(/Secret detected/);
    }
  }
  await writeFile(path, 'VITE_WEIXIN_SECRET=SYNTHETIC-ONLY-DO-NOT-USE-0123456789');
  await expect(checkSecrets({ root: dir })).rejects.toThrow(/Secret detected/);
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
test('only_the_explicit_public_methods_are_deployable', async () => {
  const dir = await fixture(); const path = join(dir, 'uniCloud-alipay/cloudfunctions/account-co'); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'index.obj.ts'), 'export async function session() {}\nexport async function registerAdmin() {}');
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|export|method/i);
});
test('family_public_surface_rejects_default_reexports_helpers_and_test_entry', async () => {
  for (const addition of ['export default {};', "export { probe } from './helper';", 'export async function fixture() {}', 'export const extra = () => {};']) {
    const dir = await fixture(); await writeFile(join(dir, 'uniCloud-alipay/cloudfunctions/family-co/index.obj.ts'), 'export async function current() {}\nexport async function create() {}\n' + addition);
    await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|export|method/i);
  }
  const dir = await fixture(); const probe = join(dir, 'uniCloud-alipay/cloudfunctions/test-co'); await mkdir(probe, { recursive: true });
  await writeFile(join(probe, 'index.obj.ts'), 'export function probe() {}');
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|object/i);
});
test('all_business_schemas_deny_every_clientdb_operation', async () => {
  const dir = await fixture(); const database = join(dir, 'uniCloud-alipay/database'); await mkdir(database, { recursive: true });
  const collections = ['families', 'family_members', 'family_invitations', 'mutation_receipts', 'request_limits', 'recipes', 'recipe_favorites', 'media_files', 'media_audit_traces'];
  const schema = { permission: { read: false, create: false, update: false, delete: false } };
  for (const collection of collections) await writeFile(join(database, collection + '.schema.json'), JSON.stringify(schema));
  await expect(checkBoundaries({ root: dir })).resolves.toBeUndefined();
  for (const collection of collections) {
    const path = join(database, collection + '.schema.json');
    for (const operation of ['read', 'create', 'update', 'delete']) {
      await writeFile(path, JSON.stringify({ permission: { ...schema.permission, [operation]: true } }));
      await expect(checkBoundaries({ root: dir })).rejects.toThrow(/permission/i);
    }
    await writeFile(path, JSON.stringify(schema));
  }
});
test('client_cannot_import_family_or_content_check_runtime', async () => {
  const dir = await fixture();
  for (const source of ["import { createFamilyService } from 'home-family';", "const check = require('uni-sec-check');", "const check = import('uni-open-bridge-common');"]) {
    await writeFile(join(dir, 'src/escape.ts'), source); await expect(checkBoundaries({ root: dir })).rejects.toThrow(/client|runtime/i);
  }
});
test('cloud_file_dependencies_must_resolve_to_real_deployable_packages', async () => {
  const dir = await fixture(); const path = join(dir, 'uniCloud-alipay/cloudfunctions/family-co/package.json');
  await writeFile(path, JSON.stringify({ name: 'family-co', dependencies: { 'home-family': 'file:../common/missing' } }));
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/dependency|package/i);
});
test('account_object_reexports_cannot_expand_public_surface', async () => {
  const dir = await fixture(); await writeFile(join(dir, 'uniCloud-alipay/cloudfunctions/account-co/index.obj.ts'), "export async function session() {}\nexport { registerAdmin } from './helper';");
  await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|export|method/i);
});
test('recipe_object_rejects_helpers_default_exports_and_future_methods', async () => {
  const dir = await fixture(); const path = join(dir, 'uniCloud-alipay/cloudfunctions/recipes-co/index.obj.ts');
  const valid = await readFile(path, 'utf8');
  for (const extra of ['export async function seed() {}', 'export async function remove() {}', 'export default {}', "export { helper } from './helper';"]) {
    await writeFile(path, valid + '\n' + extra);
    await expect(checkBoundaries({ root: dir })).rejects.toThrow(/public|export|method/i);
  }
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
test('jina_reader_key_is_rejected_in_source_without_echoing_value', async () => {
  const dir = await fixture(); const path = join(dir, 'src/error.js'); const synthetic = 'SYNTHETIC-ONLY-DO-NOT-USE-0123456789';
  for (const source of [`const config = { JINA_API_KEY: '${synthetic}' };`, `const key = 'jina_${synthetic.replace(/-/g, '')}';`, `VITE_JINA_KEY=${synthetic}`]) {
    await writeFile(path, source);
    try { await checkSecrets({ root: dir }); throw new Error('Scanner incorrectly accepted fixture'); }
    catch (error) { expect(String(error)).toMatch(/Secret detected/); expect(String(error)).not.toContain(synthetic); }
  }
});
