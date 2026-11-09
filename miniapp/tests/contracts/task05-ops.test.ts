import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { expect, test } from 'vitest';
import { doctor } from '../../scripts/doctor.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { testDirectory } from '../support/temp-directory';

test('task05_requires_its_own_cloud_device_evidence_and_never_inherits_task04_closeout', async () => {
  const root = await testDirectory('task05-proof-'); await mkdir(join(root, 'ops'));
  await writeFile(join(root, 'ops/project-target.json'), await readFile('ops/project-target.json'));
  await writeFile(join(root, 'ops/task04-acceptance.json'), JSON.stringify({ cloud: { status: 'passed' }, device: { status: 'passed' } }));
  const result = await doctor({ root, ticket: 'task05' });
  expect(result.ready).toBe(false); expect(result.blockers).toContain('task05-acceptance-missing');
});
test('task05_offline_preview_is_scoped_and_preserves_historical_evidence', async () => {
  const original = await readFile('ops/task04-acceptance.json', 'utf8');
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task05' });
  expect(preview).toMatchObject({ ticket: 'task05', previewOnly: true, uploadAuthorized: false, blocked: true });
  expect((preview.proposedChanges ?? []).map((entry: { name: string }) => entry.name).sort()).toEqual([
    'home-contracts', 'home-family', 'home-kernel', 'home-recipes', 'mutation_receipts.schema.json', 'recipes-co', 'recipes.index.json', 'recipes.schema.json',
  ]);
  expect(await readFile('ops/task04-acceptance.json', 'utf8')).toBe(original);
});

test('task05_gate_binds_every_scenario_to_separate_source_cloud_and_device_artifacts', async () => {
  const { TASK05_SCENARIOS, task05Snapshot } = await import('../../scripts/task05-state.mjs');
  const root = await testDirectory('task05-proof-');
  for (const path of ['ops', 'src', 'dist/build/mp-weixin', 'dist/task05-device/mp-weixin', 'dist/task05-normal-cloud/cloudfunctions/family-co']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'export const app = true;');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'client();');
  await writeFile(join(root, 'dist/task05-device/mp-weixin/app.js'), 'deviceWithLinkedSpace();');
  await writeFile(join(root, 'dist/task05-normal-cloud/cloudfunctions/family-co/index.obj.js'), 'module.exports = {};');
  const target = JSON.parse(await readFile('ops/project-target.json', 'utf8')); await writeFile(join(root, 'ops/project-target.json'), JSON.stringify(target));
  await writeFile(join(root, 'ops/task05-proof.md'), 'Synthetic gate fixture, never real acceptance.');
  const snapshot = await task05Snapshot({ root }); const record = { status: 'passed', evidenceFile: 'ops/task05-proof.md', evidenceRef: 'synthetic' };
  const evidence = { ticket: 'task05', version: 1, target, sourceSha256: snapshot.sourceSha256, configuration: record,
    ...Object.fromEntries(Object.entries(TASK05_SCENARIOS).map(([phase, scenarios]) => [phase, { ...record, buildSha256: phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256, scenarios: Object.fromEntries(scenarios.map(name => [name, { ...record }])) }])) };
  const save = () => writeFile(join(root, 'ops/task05-acceptance.json'), JSON.stringify(evidence)); await save();
  expect(await doctor({ root, ticket: 'task05' })).toEqual({ ready: true, blockers: [] });
  const cloud = (evidence as Record<string, unknown>).cloud as { scenarios: Record<string, unknown> }; delete cloud.scenarios['stale-first-delivery']; await save();
  expect((await doctor({ root, ticket: 'task05' })).blockers).toContain('task05-cloud-scenario:stale-first-delivery');
  await writeFile(join(root, 'src/app.ts'), 'changed'); expect((await doctor({ root, ticket: 'task05' })).blockers).toContain('task05-source-drift');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'changed'); expect((await doctor({ root, ticket: 'task05' })).blockers).toContain('task05-local-build-drift');
  expect((await doctor({ root, ticket: 'task05' })).blockers).not.toContain('task05-device-build-drift');
  await writeFile(join(root, 'dist/task05-device/mp-weixin/app.js'), 'changed'); expect((await doctor({ root, ticket: 'task05' })).blockers).toContain('task05-device-build-drift');
  await writeFile(join(root, 'dist/task05-normal-cloud/cloudfunctions/family-co/index.obj.js'), 'changed'); expect((await doctor({ root, ticket: 'task05' })).blockers).toContain('task05-cloud-build-drift');
});
