import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { walk } from './check-boundaries.mjs';
import { treeSha256 } from './task02-state.mjs';

export const TASK03_SCENARIOS = {
  local: ['full-check'],
  cloud: ['expiry-boundary', 'single-use-race', 'same-request', 'conflicting-payload', 'multiple-invites', 'create-join-race', 'different-invites-race', 'revoke-join-race',
    'primary-key', 'rollback-writes', 'commit-ack-lost', 'verified-conflict-codes', 'member-forbidden', 'existing-family', 'cross-family', 'stale-generation', 'key-rotation',
    'quota-cross-instance', 'safe-dtos', 'no-plaintext-records', 'platform-log-capture', 'normal-artifact-and-cleanup',
    ...['families', 'family_members', 'family_invitations', 'mutation_receipts', 'request_limits'].flatMap(name => ['read', 'create', 'update', 'delete'].map(operation => `clientdb-${name}-${operation}`))],
  device: ['share-card', 'anonymous-login-continuation', 'manual-paste', 'explicit-confirmation', 'shared-members', 'weak-network-cold-start', 'logout-account-isolation'],
};
export async function task03Snapshot({ root }) {
  const source = [];
  for (const directory of ['src', 'uniCloud-alipay', 'cloud-policies', 'scripts', 'tests']) source.push(...await walk(join(root, directory)));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'Taskfile.yml', 'tsconfig.json', 'tsconfig.cloud.json', 'tsconfig.tests.json', 'vite.config.ts', 'vitest.config.ts', 'ops/project-target.json']) {
    const path = join(root, name); try { if ((await stat(path)).isFile()) source.push(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const cloudRoot = join(root, 'dist/task03-normal-cloud'); const cloud = await walk(cloudRoot);
  const production = [...await walk(join(root, 'uniCloud-alipay')), ...cloud, ...await walk(join(root, 'dist/build/mp-weixin')), ...await walk(join(root, 'dist/task03-device/mp-weixin'))];
  const remnants = production.filter(path => /(?:task03-probe|tests[\\/]cloud|(?:^|[\\/])(?:probe|fixture)[-.])/i.test(path)
    || (/[\\/]index\.obj\.[jt]s$/.test(path) && !/[\\/](?:uni-id-co|account-co|family-co)[\\/]index\.obj\.[jt]s$/.test(path)));
  return { sourceSha256: await treeSha256(root, source), clientBuildSha256: await treeSha256(join(root, 'dist/build/mp-weixin')), deviceBuildSha256: await treeSha256(join(root, 'dist/task03-device/mp-weixin')), cloudBuildSha256: await treeSha256(cloudRoot), probeRemnants: [...new Set(remnants.map(path => relative(root, path).split('\\').join('/')))] };
}
export async function task03Readiness({ root, evidence, target }) {
  if (!evidence || evidence.ticket !== 'task03' || evidence.version !== 1) return ['task03-acceptance-missing'];
  const blockers = []; const snapshot = await task03Snapshot({ root });
  if (!target || JSON.stringify(target) !== JSON.stringify(evidence.target)) blockers.push('task03-target-mismatch');
  if (!snapshot.sourceSha256 || evidence.sourceSha256 !== snapshot.sourceSha256) blockers.push('task03-source-drift');
  if (!snapshot.clientBuildSha256) blockers.push('task03-client-artifact-missing');
  if (!snapshot.cloudBuildSha256) blockers.push('task03-cloud-artifact-missing');
  if (!snapshot.deviceBuildSha256) blockers.push('task03-device-artifact-missing');
  if (snapshot.probeRemnants.length) blockers.push('task03-probe-remnants');
  async function proven(record) {
    if (record?.status !== 'passed' || typeof record.evidenceRef !== 'string' || !record.evidenceRef.trim() || record.evidenceRef === 'not-executed'
      || typeof record.evidenceFile !== 'string' || !/^ops\/task03-[a-z0-9-]+\.md$/.test(record.evidenceFile)) return false;
    try { return (await stat(join(root, record.evidenceFile))).isFile() && !!(await readFile(join(root, record.evidenceFile), 'utf8')).trim(); } catch { return false; }
  }
  if (!await proven(evidence.configuration)) blockers.push('task03-configuration-unverified');
  for (const [phase, scenarios] of Object.entries(TASK03_SCENARIOS)) {
    const record = evidence[phase]; const digest = phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256;
    if (!await proven(record)) blockers.push(`task03-${phase}-acceptance-missing`);
    if (!digest || record?.buildSha256 !== digest) blockers.push(`task03-${phase}-build-drift`);
    for (const scenario of scenarios) if (!await proven(record?.scenarios?.[scenario])) blockers.push(`task03-${phase}-scenario:${scenario}`);
  }
  return blockers;
}
