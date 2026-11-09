import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { expect, test } from 'vitest';
import { doctor } from '../../scripts/doctor.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { testDirectory } from '../support/temp-directory';

test('task06_never_inherits_task05_acceptance', async () => {
  const root = await testDirectory('task06-proof-'); await mkdir(join(root, 'ops'));
  await writeFile(join(root, 'ops/project-target.json'), await readFile('ops/project-target.json'));
  await writeFile(join(root, 'ops/task05-acceptance.json'), JSON.stringify({ cloud: { status: 'passed' }, device: { status: 'passed' } }));
  expect(await doctor({ root, ticket: 'task06' })).toEqual({ ready: false, blockers: ['task06-acceptance-missing'] });
});

test('task06_preview_includes_private_schema_and_only_required_changes', async () => {
  const original = await readFile('ops/task05-acceptance.json', 'utf8');
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task06' });
  expect(preview).toMatchObject({ ticket: 'task06', previewOnly: true, uploadAuthorized: false, blocked: true });
  expect(preview.sharedModuleImpact).toEqual(['account-co', 'uni-id-co', 'family-co', 'recipes-co']);
  expect((preview.proposedChanges ?? []).map((entry: { name: string }) => entry.name).sort()).toEqual([
    'home-contracts', 'home-kernel', 'home-recipes', 'mutation_receipts.schema.json', 'recipe_favorites.schema.json', 'recipes-co',
  ]);
  const schema = JSON.parse(await readFile('uniCloud-alipay/database/recipe_favorites.schema.json', 'utf8'));
  expect(schema.permission).toEqual({ read: false, create: false, update: false, delete: false });
  expect(await readFile('ops/task05-acceptance.json', 'utf8')).toBe(original);
});

test('task06_gate_binds_scenarios_and_detects_source_and_build_drift', async () => {
  const { TASK06_SCENARIOS, task06Snapshot } = await import('../../scripts/task06-state.mjs');
  const root = await testDirectory('task06-proof-');
  for (const path of ['ops', 'src', 'dist/build/mp-weixin', 'dist/task06-device/mp-weixin', 'dist/task06-normal-cloud/cloudfunctions/recipes-co']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'export const app = true;');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'client();');
  await writeFile(join(root, 'dist/task06-device/mp-weixin/app.js'), 'deviceWithLinkedSpace();');
  await writeFile(join(root, 'dist/task06-normal-cloud/cloudfunctions/recipes-co/index.obj.js'), 'module.exports = {};');
  const target = JSON.parse(await readFile('ops/project-target.json', 'utf8')); await writeFile(join(root, 'ops/project-target.json'), JSON.stringify(target));
  await writeFile(join(root, 'ops/task06-proof.md'), 'Synthetic gate fixture, never actual acceptance.');
  const snapshot = await task06Snapshot({ root }); const record = { status: 'passed', evidenceFile: 'ops/task06-proof.md', evidenceRef: 'synthetic' };
  const evidence = { ticket: 'task06', version: 1, target, sourceSha256: snapshot.sourceSha256, configuration: record,
    ...Object.fromEntries(Object.entries(TASK06_SCENARIOS).map(([phase, scenarios]) => [phase, { ...record,
      buildSha256: phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256,
      scenarios: Object.fromEntries(scenarios.map(name => [name, { ...record }])) }])) };
  const save = () => writeFile(join(root, 'ops/task06-acceptance.json'), JSON.stringify(evidence)); await save();
  expect(await doctor({ root, ticket: 'task06' })).toEqual({ ready: true, blockers: [] });
  const cloud = (evidence as Record<string, unknown>).cloud as { scenarios: Record<string, unknown> }; delete cloud.scenarios['favorite-private']; await save();
  expect((await doctor({ root, ticket: 'task06' })).blockers).toContain('task06-cloud-scenario:favorite-private');
  await writeFile(join(root, 'src/app.ts'), 'changed'); expect((await doctor({ root, ticket: 'task06' })).blockers).toContain('task06-source-drift');
  for (const [path, phase] of [['dist/build/mp-weixin/app.js', 'local'], ['dist/task06-device/mp-weixin/app.js', 'device'], ['dist/task06-normal-cloud/cloudfunctions/recipes-co/index.obj.js', 'cloud']]) {
    await writeFile(join(root, path), 'changed'); expect((await doctor({ root, ticket: 'task06' })).blockers).toContain(`task06-${phase}-build-drift`);
  }
});
