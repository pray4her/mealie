import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { doctor } from '../../scripts/doctor.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { testDirectory } from '../support/temp-directory';

test('task04_cannot_inherit_the_closed_invitation_tickets_acceptance', async () => {
  const root = await testDirectory('task04-gate-'); await mkdir(join(root, 'ops'));
  await writeFile(join(root, 'ops/project-target.json'), await readFile('ops/project-target.json'));
  await writeFile(join(root, 'ops/task03-acceptance.json'), JSON.stringify({ cloud: { status: 'passed' }, device: { status: 'passed' } }));
  const result = await doctor({ root, ticket: 'task04' });
  expect(result.ready).toBe(false); expect(result.blockers).toContain('task04-acceptance-missing');
});
test('task04_preview_is_offline_and_proposes_only_the_four_changed_cloud_resources', async () => {
  const historical = await readFile('ops/task03-acceptance.json', 'utf8');
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task04' });
  expect(preview).toMatchObject({ ticket: 'task04', previewOnly: true, uploadAuthorized: false, blocked: true, existingResources: 'unknown' });
  expect((preview.proposedChanges ?? []).map((item: { name: string }) => item.name).sort()).toEqual(['family-co', 'home-contracts', 'home-family', 'mutation_receipts.schema.json']);
  expect(preview.protectedDependencies).toEqual(['uni-id-common', 'uni-config-center', 'uni-open-bridge-common']);
  expect(await readFile('ops/task03-acceptance.json', 'utf8')).toBe(historical);
});
test('task04_gate_binds_every_scenario_to_separate_source_cloud_and_device_artifacts', async () => {
  const { TASK04_SCENARIOS, task04Snapshot } = await import('../../scripts/task04-state.mjs');
  const root = await testDirectory('task04-proof-');
  for (const path of ['ops', 'src', 'dist/build/mp-weixin', 'dist/task04-device/mp-weixin', 'dist/task04-normal-cloud/cloudfunctions/family-co']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'export const app = true;');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'client();');
  await writeFile(join(root, 'dist/task04-device/mp-weixin/app.js'), 'deviceWithLinkedSpace();');
  await writeFile(join(root, 'dist/task04-normal-cloud/cloudfunctions/family-co/index.obj.js'), 'module.exports = {};');
  const target = JSON.parse(await readFile('ops/project-target.json', 'utf8')); await writeFile(join(root, 'ops/project-target.json'), JSON.stringify(target));
  await writeFile(join(root, 'ops/task04-proof.md'), 'Synthetic gate fixture, never real acceptance.');
  const snapshot = await task04Snapshot({ root }); const record = { status: 'passed', evidenceFile: 'ops/task04-proof.md', evidenceRef: 'synthetic' };
  const evidence = { ticket: 'task04', version: 1, target, sourceSha256: snapshot.sourceSha256, configuration: record,
    ...Object.fromEntries(Object.entries(TASK04_SCENARIOS).map(([phase, scenarios]) => [phase, { ...record, buildSha256: phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256, scenarios: Object.fromEntries(scenarios.map(name => [name, { ...record }])) }])) };
  const save = () => writeFile(join(root, 'ops/task04-acceptance.json'), JSON.stringify(evidence)); await save();
  expect(await doctor({ root, ticket: 'task04' })).toEqual({ ready: true, blockers: [] });
  const cloud = (evidence as Record<string, unknown>).cloud as { scenarios: Record<string, unknown> }; delete cloud.scenarios['stale-first-delivery']; await save();
  expect((await doctor({ root, ticket: 'task04' })).blockers).toContain('task04-cloud-scenario:stale-first-delivery');
  await writeFile(join(root, 'src/app.ts'), 'changed'); expect((await doctor({ root, ticket: 'task04' })).blockers).toContain('task04-source-drift');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'changed'); expect((await doctor({ root, ticket: 'task04' })).blockers).toContain('task04-local-build-drift');
  expect((await doctor({ root, ticket: 'task04' })).blockers).not.toContain('task04-device-build-drift');
  await writeFile(join(root, 'dist/task04-device/mp-weixin/app.js'), 'changed'); expect((await doctor({ root, ticket: 'task04' })).blockers).toContain('task04-device-build-drift');
  await writeFile(join(root, 'dist/task04-normal-cloud/cloudfunctions/family-co/index.obj.js'), 'changed'); expect((await doctor({ root, ticket: 'task04' })).blockers).toContain('task04-cloud-build-drift');
});
