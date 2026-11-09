import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { walk } from './check-boundaries.mjs';
import { treeSha256 } from './task02-state.mjs';

export const TASK05_SCENARIOS = {
  local: ['full-check'],
  cloud: ['create-read-update', 'unknown-quantity', 'text-boundaries', 'cross-family', 'forged-ownership', 'stale-edit', 'same-version-race', 'same-request', 'conflicting-payload',
    'rollback-writes', 'commit-ack-lost', 'protected-write-race', 'audit-delayed-removal', 'rejoin-generation', 'stale-first-delivery', 'read-revocation',
    'content-pass', 'content-rejected', 'content-unavailable', 'quota-cross-instance', 'verified-conflict-codes', 'schema-indexes', 'safe-dtos', 'platform-log-capture', 'normal-artifact-and-cleanup',
    ...['read', 'create', 'update', 'delete'].map(operation => 'clientdb-recipes-' + operation)],
  device: ['create-read-edit', 'ingredient-step-rows', 'unknown-quantity', 'shared-edit-conflict', 'weak-network-original-request', 'pending-cold-start', 'hidden-late-response', 'removed-member-onboarding', 'logout-account-isolation'],
};
export async function task05Snapshot({ root }) {
  const source = [];
  for (const directory of ['src', 'uniCloud-alipay', 'cloud-policies', 'scripts', 'tests']) source.push(...await walk(join(root, directory)));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'Taskfile.yml', 'tsconfig.json', 'tsconfig.cloud.json', 'tsconfig.tests.json', 'vite.config.ts', 'vitest.config.ts', 'ops/project-target.json']) {
    const path = join(root, name); try { if ((await stat(path)).isFile()) source.push(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const cloudRoot = join(root, 'dist/task05-normal-cloud'); const cloud = await walk(cloudRoot);
  const production = [...await walk(join(root, 'uniCloud-alipay')), ...cloud, ...await walk(join(root, 'dist/build/mp-weixin')), ...await walk(join(root, 'dist/task05-device/mp-weixin'))];
  const remnants = production.filter(path => /(?:task\d+-probe|tests[\\/]cloud|(?:^|[\\/])(?:probe|fixture)[-.])/i.test(path)
    || (/[\\/]index\.obj\.[jt]s$/.test(path) && !/[\\/](?:uni-id-co|account-co|family-co|recipes-co)[\\/]index\.obj\.[jt]s$/.test(path)));
  return { sourceSha256: await treeSha256(root, source), clientBuildSha256: await treeSha256(join(root, 'dist/build/mp-weixin')), deviceBuildSha256: await treeSha256(join(root, 'dist/task05-device/mp-weixin')), cloudBuildSha256: await treeSha256(cloudRoot), probeRemnants: [...new Set(remnants.map(path => relative(root, path).split('\\').join('/')))] };
}
export async function task05Readiness({ root, evidence, target }) {
  if (!evidence || evidence.ticket !== 'task05' || evidence.version !== 1) return ['task05-acceptance-missing'];
  const blockers = []; const snapshot = await task05Snapshot({ root });
  if (!target || JSON.stringify(target) !== JSON.stringify(evidence.target)) blockers.push('task05-target-mismatch');
  if (!snapshot.sourceSha256 || evidence.sourceSha256 !== snapshot.sourceSha256) blockers.push('task05-source-drift');
  if (!snapshot.clientBuildSha256) blockers.push('task05-client-artifact-missing');
  if (!snapshot.cloudBuildSha256) blockers.push('task05-cloud-artifact-missing');
  if (!snapshot.deviceBuildSha256) blockers.push('task05-device-artifact-missing');
  if (snapshot.probeRemnants.length) blockers.push('task05-probe-remnants');
  async function proven(record) {
    if (record?.status !== 'passed' || typeof record.evidenceRef !== 'string' || !record.evidenceRef.trim() || record.evidenceRef === 'not-executed'
      || typeof record.evidenceFile !== 'string' || !/^ops\/task05-[a-z0-9-]+\.md$/.test(record.evidenceFile)) return false;
    try { return (await stat(join(root, record.evidenceFile))).isFile() && !!(await readFile(join(root, record.evidenceFile), 'utf8')).trim(); } catch { return false; }
  }
  if (!await proven(evidence.configuration)) blockers.push('task05-configuration-unverified');
  for (const [phase, scenarios] of Object.entries(TASK05_SCENARIOS)) {
    const record = evidence[phase]; const digest = phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256;
    if (!await proven(record)) blockers.push(`task05-${phase}-acceptance-missing`);
    if (!digest || record?.buildSha256 !== digest) blockers.push(`task05-${phase}-build-drift`);
    for (const scenario of scenarios) if (!await proven(record?.scenarios?.[scenario])) blockers.push(`task05-${phase}-scenario:${scenario}`);
  }
  return blockers;
}
