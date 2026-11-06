import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { assembleUniId, unzip } from '../../scripts/assemble-uni-id.mjs';
import { testDirectory } from '../support/temp-directory';
const archivePath = resolve('vendor/uni-id/upstream.zip'); const lockPath = resolve('vendor/uni-id/lock.json');
async function target() { return testDirectory('assembly-'); }
test('archive_digest_mismatch_is_rejected', async () => {
  const dir = await target(); const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.sha256 = '0'.repeat(64);
  const bad = join(dir, 'lock.json'); await writeFile(bad, JSON.stringify(lock));
  await expect(assembleUniId({ archivePath, lockPath: bad, targetPath: dir })).rejects.toThrow(/digest/i);
});
test('unknown_source_is_rejected', async () => {
  const dir = await target(); const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.repository = 'https://example.invalid/source';
  const bad = join(dir, 'lock.json'); await writeFile(bad, JSON.stringify(lock));
  await expect(assembleUniId({ archivePath, lockPath: bad, targetPath: dir })).rejects.toThrow(/source/i);
});
test('archive_root_path_escape_is_rejected', async () => {
  const dir = await target(); const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.root = '../escape';
  const bad = join(dir, 'lock.json'); await writeFile(bad, JSON.stringify(lock));
  await expect(assembleUniId({ archivePath, lockPath: bad, targetPath: dir })).rejects.toThrow(/path/i);
});
test('archive_entry_path_escape_is_rejected_even_with_matching_digest', async () => {
  const dir = await target(); const bytes = Buffer.from(await readFile(archivePath));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.write('../', central + 46, 'ascii');
  const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.sha256 = createHash('sha256').update(bytes).digest('hex');
  const archive = join(dir, 'unsafe.zip'); const manifest = join(dir, 'unsafe-lock.json'); await writeFile(archive, bytes); await writeFile(manifest, JSON.stringify(lock));
  await expect(assembleUniId({ archivePath: archive, lockPath: manifest, targetPath: dir })).rejects.toThrow(/path/i);
});
test('archive_commit_comment_must_match_locked_revision', async () => {
  const dir = await target(); const bytes = Buffer.from(await readFile(archivePath)); bytes.write('0'.repeat(40), bytes.length - 40, 'ascii');
  const lock = JSON.parse(await readFile(lockPath, 'utf8')); lock.sha256 = createHash('sha256').update(bytes).digest('hex');
  const archive = join(dir, 'wrong-revision.zip'); const manifest = join(dir, 'lock.json'); await writeFile(archive, bytes); await writeFile(manifest, JSON.stringify(lock));
  await expect(assembleUniId({ archivePath: archive, lockPath: manifest, targetPath: dir })).rejects.toThrow(/revision/i);
});
test('repeated_generation_is_byte_identical', async () => {
  const dir = await target(); const a = await assembleUniId({ archivePath, lockPath, targetPath: dir });
  const bytes = await Promise.all(a.outputs.map((path: string) => readFile(join(dir, path), 'utf8')));
  const b = await assembleUniId({ archivePath, lockPath, targetPath: dir });
  expect(b).toEqual(a); expect(await Promise.all(b.outputs.map((path: string) => readFile(join(dir, path), 'utf8')))).toEqual(bytes);
});
test('never_overwrites_non_generated_files', async () => {
  const dir = await target(); const path = join(dir, 'src/uni_modules/uni-id-pages/package.json');
  await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'user-owned');
  await expect(assembleUniId({ archivePath, lockPath, targetPath: dir })).rejects.toThrow(/overwrite/i);
  expect(await readFile(path, 'utf8')).toBe('user-owned');
});

test('known_hbuilderx_config_center_provenance_is_adopted_repeatably', async () => {
  const dir = await target(); await assembleUniId({ archivePath, lockPath, targetPath: dir });
  const path = join(dir, 'src/uni_modules/uni-config-center/uniCloud/cloudfunctions/common/uni-config-center/package.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const original = unzip(await readFile(archivePath)).get(lock.root + '/uni_modules/uni-config-center/uniCloud/cloudfunctions/common/uni-config-center/package.json')!;
  const manifestPath = join(dir, 'vendor/uni-id/generated.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files['src/uni_modules/uni-config-center/uniCloud/cloudfunctions/common/uni-config-center/package.json'] = createHash('sha256').update(original).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const pkg = JSON.parse(original.toString());
  Object.assign(pkg, { 'origin-plugin-dev-name': 'uni-config-center', 'origin-plugin-version': '0.0.3', 'plugin-dev-name': 'uni-config-center', 'plugin-version': '0.0.3' });
  await writeFile(path, JSON.stringify(pkg, null, 4));
  await assembleUniId({ archivePath, lockPath, targetPath: dir });
  await expect(assembleUniId({ archivePath, lockPath, targetPath: dir, check: true })).resolves.toBeDefined();
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(pkg);
  pkg.main = 'changed.js'; await writeFile(path, JSON.stringify(pkg));
  await expect(assembleUniId({ archivePath, lockPath, targetPath: dir })).rejects.toThrow(/overwrite/i);
});
