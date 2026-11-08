import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { doctor } from '../../scripts/doctor.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { checkSecrets } from '../../scripts/check-secrets.mjs';
import { testDirectory } from '../support/temp-directory';

test('task03_cannot_inherit_task01_or_task02_acceptance', async () => {
  const root = await testDirectory('task03-gate-'); await mkdir(join(root, 'ops'));
  await writeFile(join(root, 'ops/project-target.json'), await readFile('ops/project-target.json'));
  for (const ticket of ['acceptance', 'task02-acceptance']) await writeFile(join(root, `ops/${ticket}.json`), JSON.stringify({ cloud: { status: 'passed' }, device: { status: 'passed' } }));
  const result = await doctor({ root, ticket: 'task03' });
  expect(result.ready).toBe(false); expect(result.blockers).toContain('task03-acceptance-missing');
});
test('task03_preview_is_offline_and_only_proposes_the_new_invitation_resources', async () => {
  const historical = await readFile('ops/task02-acceptance.json', 'utf8');
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task03' });
  expect(preview).toMatchObject({ ticket: 'task03', previewOnly: true, uploadAuthorized: false, blocked: true, existingResources: 'unknown' });
  expect(preview.resources).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'family_invitations.schema.json', action: 'blocked-no-upload' }),
    expect.objectContaining({ name: 'family_invitations.index.json', action: 'blocked-no-upload' }),
  ]));
  expect((preview.proposedChanges ?? []).map((item: { name: string }) => item.name).sort()).toEqual(['family-co', 'family_invitations.index.json', 'family_invitations.schema.json', 'home-contracts', 'home-family', 'home-kernel', 'mutation_receipts.schema.json']);
  expect(preview.invitationConfiguration).toMatchObject({ valuesIncluded: false, logCaptureVerified: false });
  expect(await readFile('ops/task02-acceptance.json', 'utf8')).toBe(historical);
});
test('scanner_rejects_embedded_invitation_keys_and_capabilities_without_echoing_them', async () => {
  const root = await testDirectory('task03-secret-'); await mkdir(join(root, 'src'));
  const value = `v1.synthetic.${'a'.repeat(32)}.${'A'.repeat(43)}`;
  const path = join(root, 'src/leak.js');
  for (const source of [`const capability = '${value}';`, `const FAMILY_INVITATION_KEYS = '${JSON.stringify({ fixture: 'ab'.repeat(32) })}';`, "const secret = import.meta.env.VITE_FAMILY_INVITATION_KEYS;"]) {
    await writeFile(path, source);
    try { await checkSecrets({ root }); throw new Error('scanner accepted secret'); }
    catch (error) { expect(String(error)).toContain('Secret detected'); expect(String(error)).not.toContain(value); }
  }
});
test('task03_readiness_requires_each_scenario_and_invalidates_source_and_build_drift', async () => {
  const { TASK03_SCENARIOS, task03Snapshot } = await import('../../scripts/task03-state.mjs');
  const root = await testDirectory('task03-proof-');
  for (const path of ['ops', 'src', 'dist/build/mp-weixin', 'dist/task03-device/mp-weixin', 'dist/task03-normal-cloud/cloudfunctions/family-co']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'export const app = true;');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'client();');
  await writeFile(join(root, 'dist/task03-device/mp-weixin/app.js'), 'deviceWithLinkedSpace();');
  await writeFile(join(root, 'dist/task03-normal-cloud/cloudfunctions/family-co/index.obj.js'), 'module.exports = {};');
  const target = JSON.parse(await readFile('ops/project-target.json', 'utf8')); await writeFile(join(root, 'ops/project-target.json'), JSON.stringify(target));
  await writeFile(join(root, 'ops/task03-proof.md'), 'Synthetic evidence gate fixture, never real acceptance.');
  const snapshot = await task03Snapshot({ root }); const record = { status: 'passed', evidenceFile: 'ops/task03-proof.md', evidenceRef: 'synthetic' };
  expect(snapshot.deviceBuildSha256).toMatch(/^[a-f0-9]{64}$/); expect(snapshot.deviceBuildSha256).not.toBe(snapshot.clientBuildSha256);
  const evidence = { ticket: 'task03', version: 1, target, sourceSha256: snapshot.sourceSha256, configuration: record,
    ...Object.fromEntries(Object.entries(TASK03_SCENARIOS).map(([phase, scenarios]) => [phase, { ...record, buildSha256: phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256, scenarios: Object.fromEntries(scenarios.map(name => [name, { ...record }])) }])) };
  const save = () => writeFile(join(root, 'ops/task03-acceptance.json'), JSON.stringify(evidence)); await save();
  expect(await doctor({ root, ticket: 'task03' })).toEqual({ ready: true, blockers: [] });
  const cloud = (evidence as Record<string, unknown>).cloud as { scenarios: Record<string, unknown> }; delete cloud.scenarios['single-use-race']; await save();
  expect((await doctor({ root, ticket: 'task03' })).blockers).toContain('task03-cloud-scenario:single-use-race');
  await writeFile(join(root, 'src/app.ts'), 'changed');
  expect((await doctor({ root, ticket: 'task03' })).blockers).toContain('task03-source-drift');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'changed');
  expect((await doctor({ root, ticket: 'task03' })).blockers).toContain('task03-local-build-drift');
  expect((await doctor({ root, ticket: 'task03' })).blockers).not.toContain('task03-device-build-drift');
  await writeFile(join(root, 'dist/task03-device/mp-weixin/app.js'), 'changed');
  expect((await doctor({ root, ticket: 'task03' })).blockers).toContain('task03-device-build-drift');
});
