import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { createStorageProbe, type StorageProbePort } from '../cloud/task07-storage-probe';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { stageTask07StorageProbe } from '../../scripts/stage-task07-storage-probe.mjs';
import { testDirectory } from '../support/temp-directory';

const capability = 'a'.repeat(64);
const sample = Buffer.from('synthetic-image');
const prefix = 'task07-private/task07-probe-123456789abc';
const ids = [`cloud://test-space/${prefix}/sample.png`, `cloud://test-space/${prefix}/nested/sample.png`];

function harness() {
  const files = new Map<string, Buffer>(); const writes: string[] = [];
  const cloud: StorageProbePort = {
    async uploadFile({ cloudPath, fileContent }) {
      writes.push(cloudPath); const fileID = `cloud://test-space/${cloudPath}`;
      files.set(fileID, Buffer.from(fileContent)); return { fileID };
    },
    async downloadFile({ fileID }) {
      const fileContent = files.get(fileID);
      if (!fileContent) throw new Error('not found: private platform details');
      return { fileContent };
    },
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://example.com/sample.png?signature=private', status: 0 })) };
    },
    async deleteFile({ fileList }) {
      for (const id of fileList) files.delete(id);
      return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
    },
  };
  const run = createStorageProbe({ cloud, prefix, spaceId: 'test-space', sample,
    capabilityHash: createHash('sha256').update(capability).digest('hex') });
  return { run, files, writes, cloud };
}

test('storage_probe_rejects_missing_or_forged_capability_before_any_storage_write', async () => {
  const h = harness();
  for (const input of [undefined, {}, { operation: 'seed', capability: 'b'.repeat(64) }]) {
    expect(await h.run(input)).toEqual({ ok: false, errorCode: 'FORBIDDEN' });
  }
  expect(h.writes).toEqual([]);
});

test('storage_probe_never_accepts_caller_supplied_file_paths_or_unknown_operations', async () => {
  const h = harness();
  for (const input of [{ operation: 'seed', capability, cloudPath: 'business/private.png' }, { operation: 'anything', capability }]) {
    expect(await h.run(input)).toEqual({ ok: false, errorCode: 'INVALID_INPUT' });
  }
  expect(h.writes).toEqual([]);
});

test('storage_probe_roundtrips_only_its_two_synthetic_files_and_detects_replacement', async () => {
  const h = harness();
  expect(await h.run({ operation: 'seed', capability })).toMatchObject({ ok: true, fileIds: ids });
  expect(await h.run({ operation: 'inspect', capability })).toMatchObject({ ok: true, files: [
    { fileID: ids[0], matchesSample: true }, { fileID: ids[1], matchesSample: true },
  ] });
  h.files.set(ids[0], Buffer.from('replaced'));
  expect(await h.run({ operation: 'inspect', capability })).toMatchObject({ ok: true, files: [
    { fileID: ids[0], matchesSample: false }, { fileID: ids[1], matchesSample: true },
  ] });
  expect(h.writes).toEqual([`${prefix}/sample.png`, `${prefix}/nested/sample.png`]);
});

test('storage_probe_cleanup_leaves_every_other_file_untouched', async () => {
  const h = harness(); h.files.set('cloud://test-space/business/private.png', Buffer.from('keep'));
  await h.run({ operation: 'seed', capability });
  expect(await h.run({ operation: 'cleanup', capability })).toEqual({ ok: true });
  expect([...h.files.keys()]).toEqual(['cloud://test-space/business/private.png']);
});

test('storage_probe_suppresses_platform_details_on_failure', async () => {
  const h = harness();
  expect(await h.run({ operation: 'inspect', capability })).toEqual({ ok: false, errorCode: 'STORAGE_UNAVAILABLE' });
});

test('storage_probe_does_not_claim_cleanup_after_a_per_file_rejection', async () => {
  const h = harness();
  h.cloud.deleteFile = async () => ({ fileList: ids.map(fileID => ({ fileID, status: -1 })) });
  expect(await h.run({ operation: 'cleanup', capability })).toMatchObject({ ok: false, errorCode: 'STORAGE_UNAVAILABLE' });
});

test('storage_probe_signs_only_its_two_fixed_files_and_rejects_a_mismatched_reply', async () => {
  const h = harness();
  expect(await h.run({ operation: 'sign', capability })).toMatchObject({ ok: true, links: ids.map(fileID => ({ fileID })) });
  h.cloud.getTempFileURL = async () => ({ fileList: [{ fileID: 'cloud://test-space/business/private.png', tempFileURL: 'https://example.com/private' }] });
  expect(await h.run({ operation: 'sign', capability })).toEqual({ ok: false, errorCode: 'STORAGE_UNAVAILABLE' });
});

test('storage_probe_staging_keeps_capability_outside_the_deployable_function_and_generated_guard_rejects_anonymous_calls', async () => {
  const staged = await stageTask07StorageProbe({ root: resolve('.') });
  const session = JSON.parse(await readFile(join(staged.directory, 'session.local.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(staged.path, 'probe-config.json'), 'utf8'));
  expect(config).not.toHaveProperty('capability');
  expect(config.capabilityHash).toBe(createHash('sha256').update(session.capability).digest('hex'));
  const compiled = createRequire(import.meta.url)(join(staged.path, 'task07-storage-probe.js'));
  const probe = compiled.createStorageProbe({ ...config, cloud: {}, sample: Buffer.from(config.sampleBase64, 'base64') });
  expect(await probe({ operation: 'seed' })).toEqual({ ok: false, errorCode: 'FORBIDDEN' });
});

test('storage_probe_staging_refuses_another_space', async () => {
  const root = await testDirectory('task07-wrong-space-'); await mkdir(join(root, 'ops'));
  await writeFile(join(root, 'ops/project-target.json'), JSON.stringify({ provider: 'alipay', spaceId: 'production-space' }));
  await expect(stageTask07StorageProbe({ root })).rejects.toThrow('Unexpected storage probe target');
});
