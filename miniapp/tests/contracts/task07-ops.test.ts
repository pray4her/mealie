import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { TASK07_SCENARIOS, task07Readiness, task07Snapshot } from '../../scripts/task07-state.mjs';
import { testDirectory } from '../support/temp-directory';
test('task07_preview_includes_media_resources_and_never_uploads', async () => {
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task07' });
  expect(preview.uploadAuthorized).toBe(false); expect(preview.media).toMatchObject({ maxBytes: 1048576, maxImages: 20, reviewDefault: 'disabled', targetUrlSeconds: 600 });
  expect(preview.proposedChanges!.map((item: { name: string }) => item.name)).toEqual(expect.arrayContaining(['home-media', 'media-co', 'media-review-callback', 'media_files.schema.json', 'media_audit_traces.schema.json']));
  expect(preview.resources.find((item: { name: string }) => item.name === 'media-review-callback')).toMatchObject({ kind: 'cloud-function' });
  for (const name of ['media_files', 'media_audit_traces']) expect(JSON.parse(await readFile('uniCloud-alipay/database/' + name + '.schema.json', 'utf8')).permission).toEqual({ read: false, create: false, update: false, delete: false });
});
test('task07_readiness_rejects_simulation_as_real_acceptance_and_detects_source_drift', async () => {
  const root = await testDirectory('task07-ops-');
  for (const path of ['ops', 'src', 'dist/build/mp-weixin', 'dist/task07-normal-cloud', 'dist/task07-device/mp-weixin']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'export const value = 1;');
  for (const path of ['dist/build/mp-weixin', 'dist/task07-normal-cloud', 'dist/task07-device/mp-weixin']) await writeFile(join(root, path, 'app.js'), 'synthetic artifact');
  await writeFile(join(root, 'ops/task07-synthetic.md'), 'Synthetic readiness test only.'); const snapshot = await task07Snapshot({ root });
  const evidence: Record<string, unknown> = { ticket: 'task07', version: 1, sourceSha256: snapshot.sourceSha256, target: { provider: 'mock' } };
  for (const [phase, scenarios] of Object.entries(TASK07_SCENARIOS)) {
    const record = { status: 'passed', mode: phase === 'local' ? 'automated' : 'real', evidenceFile: 'ops/task07-synthetic.md' };
    evidence[phase] = { ...record, buildSha256: snapshot[phase === 'local' ? 'clientBuildSha256' : phase === 'cloud' ? 'cloudBuildSha256' : 'deviceBuildSha256'], scenarios: Object.fromEntries(scenarios.map(name => [name, record])) };
  }
  expect(await task07Readiness({ root, evidence, target: evidence.target })).toEqual([]);
  (evidence.cloud as { mode: string }).mode = 'mock'; expect(await task07Readiness({ root, evidence, target: evidence.target })).toContain('task07-cloud-acceptance-pending');
  await writeFile(join(root, 'src/app.ts'), 'export const value = 2;'); expect(await task07Readiness({ root, evidence, target: evidence.target })).toContain('task07-source-drift');
});
