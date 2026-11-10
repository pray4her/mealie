import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { expect, test } from 'vitest';
import { assembleContentCheck } from '../../scripts/assemble-content-check.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { testDirectory } from '../support/temp-directory';
const archivePath = resolve('vendor/content-check/upstream.zip');
const lockPath = resolve('vendor/content-check/lock.json');

test('official_archive_is_repeatable_and_preserves_original_source_and_license', async () => {
  const dir = await testDirectory('content-assembly-');
  const result = await assembleContentCheck({ archivePath, lockPath, targetPath: dir });
  expect(result.sha256).toBe('63f5ce5f56f0d667fe10f26474b921f387bfb22ed6501ca069552c77299435b1');
  expect(result.outputs).toHaveLength(19);
  const before = await readFile(join(dir, 'vendor/content-check/generated.json'));
  await assembleContentCheck({ archivePath, lockPath, targetPath: dir });
  expect(await readFile(join(dir, 'vendor/content-check/generated.json'))).toEqual(before);
  await assembleContentCheck({ archivePath, lockPath, targetPath: dir, check: true });
  const pkg = JSON.parse(await readFile(join(dir, 'src/uni_modules/uni-sec-check/uniCloud/cloudfunctions/common/uni-sec-check/package.json'), 'utf8'));
  expect(pkg.version).toBe('2.0.2'); expect(pkg.license).toBe('ISC');
  expect(pkg.dependencies).toEqual({ 'uni-config-center': 'file:../../../../../uni-config-center/uniCloud/cloudfunctions/common/uni-config-center', 'uni-open-bridge-common': 'file:../../../../../uni-open-bridge-common/uniCloud/cloudfunctions/common/uni-open-bridge-common' });
  expect(result.outputs.some((p: string) => /config\.json$|schema\.json$|uni-open-bridge-common\/|uni-config-center\//.test(p))).toBe(false);
  const path = join(dir, 'src/uni_modules/uni-sec-check/readme.md'); await writeFile(path, 'user changes');
  await expect(assembleContentCheck({ archivePath, lockPath, targetPath: dir })).rejects.toThrow(/overwrite/);
});
test('archive_identity_and_unknown_import_files_cannot_be_adopted', async () => {
  const dir = await testDirectory('content-assembly-');
  const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.version = '2.0.1';
  const badLock = join(dir, 'bad-lock.json'); await writeFile(badLock, JSON.stringify(lock));
  await expect(assembleContentCheck({ archivePath, lockPath: badLock, targetPath: dir })).rejects.toThrow(/source|version|digest/i);
  const badArchive = join(dir, 'bad.zip'); await writeFile(badArchive, 'synthetic');
  await expect(assembleContentCheck({ archivePath: badArchive, lockPath, targetPath: dir })).rejects.toThrow(/digest/i);
  await assembleContentCheck({ archivePath, lockPath, targetPath: dir });
  const path = join(dir, 'src/uni_modules/uni-sec-check/unknown.js'); await writeFile(path, 'user changes');
  await expect(assembleContentCheck({ archivePath, lockPath, targetPath: dir })).rejects.toThrow(/unknown|overwrite/i);
  expect(await readFile(path, 'utf8')).toBe('user changes');
});
test('task02_offline_preview_lists_exact_new_resources_and_blocks_existing_dependency_updates', async () => {
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task02' });
  expect(preview.ticket).toBe('task02'); expect(preview.uploadAuthorized).toBe(false);
  expect(preview.resources.filter((item: { kind: string }) => item.kind === 'cloud-object').map((item: { name: string }) => item.name).sort()).toEqual(['account-co', 'family-co', 'media-co', 'recipes-co', 'uni-id-co']);
  for (const name of ['families.schema.json', 'family_members.schema.json', 'mutation_receipts.schema.json', 'request_limits.schema.json', 'family_members.index.json', 'uni-sec-check', 'home-family', 'opendb-open-data.schema.json']) expect(preview.resources).toContainEqual(expect.objectContaining({ name, action: 'blocked-no-upload', existing: 'unknown' }));
  expect(preview.blockers).toContain('task02-cloud-device-acceptance-pending');
  expect(preview.dependencyRisks).toContainEqual(expect.objectContaining({ name: 'uni-open-bridge-common', localPluginVersion: '1.2.0', localCloudPackageVersion: '1.0.0', historicalCloudPluginVersion: '1.2.1', action: 'blocked-no-upload' }));
  expect(preview.sharedModuleImpact).toContain('account-co');
});
