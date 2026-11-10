import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { doctor } from '../../scripts/doctor.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { testDirectory } from '../support/temp-directory';

test('task08_preview_lists_private_timer_and_new_closed_collections_without_deployment', async () => {
  const preview = await createDeployPreview({ root: resolve('.'), ticket: 'task08' });
  expect(preview).toMatchObject({ previewOnly: true, uploadAuthorized: false, blocked: true, imports: { model: 'deepseek/deepseek-v4.1-flash-1017', rawTextDays: 7, timer: '0 * * * * * *', enabledDefault: false } });
  expect(preview.proposedChanges!.map((row: { name: string }) => row.name)).toEqual(expect.arrayContaining(['imports-co', 'import-worker', 'home-imports', 'import_jobs.schema.json', 'import_jobs.index.json', 'quota_buckets.schema.json', 'ai_usage.schema.json']));
  for (const name of ['import_jobs', 'quota_buckets', 'ai_usage']) expect(JSON.parse(await readFile('uniCloud-alipay/database/' + name + '.schema.json', 'utf8')).permission).toEqual({ read: false, create: false, update: false, delete: false });
});
test('task08_doctor_never_treats_fixtures_as_provider_timer_or_device_evidence', async () => {
  const { TASK08_SCENARIOS, task08Snapshot } = await import('../../scripts/task08-state.mjs');
  const root = await testDirectory('task08-proof-');
  for (const path of ['ops', 'src', 'dist/build/mp-weixin', 'dist/task08-normal-cloud', 'dist/task08-device/mp-weixin']) await mkdir(join(root, path), { recursive: true });
  const target = JSON.parse(await readFile('ops/project-target.json', 'utf8')); await writeFile(join(root, 'ops/project-target.json'), JSON.stringify(target));
  await writeFile(join(root, 'src/app.ts'), 'source');
  for (const path of ['dist/build/mp-weixin', 'dist/task08-normal-cloud', 'dist/task08-device/mp-weixin']) await writeFile(join(root, path, 'app.js'), 'synthetic artifact');
  await writeFile(join(root, 'ops/task08-synthetic.md'), 'Synthetic gate test, not acceptance.'); const snapshot = await task08Snapshot({ root });
  const evidence: Record<string, unknown> = { ticket: 'task08', version: 1, sourceSha256: snapshot.sourceSha256, target };
  for (const [phase, scenarios] of Object.entries(TASK08_SCENARIOS)) {
    const row = { status: 'passed', mode: phase === 'local' ? 'automated' : 'real', evidenceFile: 'ops/task08-synthetic.md' };
    evidence[phase] = { ...row, buildSha256: snapshot[phase === 'local' ? 'clientBuildSha256' : phase === 'device' ? 'deviceBuildSha256' : 'cloudBuildSha256'], scenarios: Object.fromEntries(scenarios.map(name => [name, { ...row }])) };
  }
  async function check() { await writeFile(join(root, 'ops/task08-acceptance.json'), JSON.stringify(evidence)); return doctor({ root, ticket: 'task08' }); }
  expect(await check()).toEqual({ ready: true, blockers: [] });
  for (const phase of ['provider', 'cloud', 'device']) {
    const row = evidence[phase] as { mode: string }; row.mode = 'automated'; expect((await check()).blockers).toContain('task08-' + phase + '-acceptance-pending'); row.mode = 'real';
  }
  await writeFile(join(root, 'src/app.ts'), 'drift'); expect((await check()).blockers).toContain('task08-source-drift');
});
