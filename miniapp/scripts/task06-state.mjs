import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { walk } from './check-boundaries.mjs';
import { treeSha256 } from './task02-state.mjs';

export const TASK06_SCENARIOS = {
  local: ['full-check'],
  cloud: ['literal-substring-and-tags', 'query-validation', 'bounded-scan-empty-page', 'same-time-pagination', 'cursor-scope', 'candidate-projection',
    'favorite-private', 'favorite-set-state', 'same-request', 'conflicting-payload', 'replay-after-opposite', 'cross-family', 'rejoin-generation',
    'stale-first-delivery', 'read-revocation', 'protected-write-race', 'rollback-writes', 'commit-ack-lost', 'quota-cross-instance',
    'legacy-recipe-receipt', 'schema-indexes', 'safe-dtos', 'platform-log-capture', 'normal-artifact-and-cleanup',
    ...['read', 'create', 'update', 'delete'].map(operation => 'clientdb-recipe_favorites-' + operation)],
  device: ['explicit-search-and-tag', 'all-favorites-switch', 'empty-page-continue', 'list-detail-favorite', 'favorite-remove-row', 'filter-response-race',
    'duplicate-taps', 'weak-network-original-request', 'pending-cold-start', 'hidden-late-response', 'removed-member-onboarding', 'logout-account-isolation'],
};
export async function task06Snapshot({ root }) {
  const source = [];
  for (const directory of ['src', 'uniCloud-alipay', 'cloud-policies', 'scripts', 'tests']) source.push(...await walk(join(root, directory)));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'Taskfile.yml', 'tsconfig.json', 'tsconfig.cloud.json', 'tsconfig.tests.json', 'vite.config.ts', 'vitest.config.ts', 'ops/project-target.json']) {
    const path = join(root, name); try { if ((await stat(path)).isFile()) source.push(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const cloudRoot = join(root, 'dist/task06-normal-cloud'); const cloud = await walk(cloudRoot);
  const production = [...await walk(join(root, 'uniCloud-alipay')), ...cloud, ...await walk(join(root, 'dist/build/mp-weixin')), ...await walk(join(root, 'dist/task06-device/mp-weixin'))];
  const remnants = production.filter(path => /(?:task\d+-probe|tests[\\/]cloud|(?:^|[\\/])(?:probe|fixture)[-.])/i.test(path)
    || (/[\\/]index\.obj\.[jt]s$/.test(path) && !/[\\/](?:uni-id-co|account-co|family-co|recipes-co|media-co)[\\/]index\.obj\.[jt]s$/.test(path)));
  return { sourceSha256: await treeSha256(root, source), clientBuildSha256: await treeSha256(join(root, 'dist/build/mp-weixin')), deviceBuildSha256: await treeSha256(join(root, 'dist/task06-device/mp-weixin')), cloudBuildSha256: await treeSha256(cloudRoot), probeRemnants: [...new Set(remnants.map(path => relative(root, path).split('\\').join('/')))] };
}
export async function task06Readiness({ root, evidence, target }) {
  if (!evidence || evidence.ticket !== 'task06' || evidence.version !== 1) return ['task06-acceptance-missing'];
  const blockers = []; const snapshot = await task06Snapshot({ root });
  if (!target || JSON.stringify(target) !== JSON.stringify(evidence.target)) blockers.push('task06-target-mismatch');
  if (!snapshot.sourceSha256 || evidence.sourceSha256 !== snapshot.sourceSha256) blockers.push('task06-source-drift');
  if (!snapshot.clientBuildSha256) blockers.push('task06-client-artifact-missing');
  if (!snapshot.cloudBuildSha256) blockers.push('task06-cloud-artifact-missing');
  if (!snapshot.deviceBuildSha256) blockers.push('task06-device-artifact-missing');
  if (snapshot.probeRemnants.length) blockers.push('task06-probe-remnants');
  async function proven(record) {
    if (record?.status !== 'passed' || typeof record.evidenceRef !== 'string' || !record.evidenceRef.trim() || record.evidenceRef === 'not-executed'
      || typeof record.evidenceFile !== 'string' || !/^ops\/task06-[a-z0-9-]+\.md$/.test(record.evidenceFile)) return false;
    try { return (await stat(join(root, record.evidenceFile))).isFile() && !!(await readFile(join(root, record.evidenceFile), 'utf8')).trim(); } catch { return false; }
  }
  if (!await proven(evidence.configuration)) blockers.push('task06-configuration-unverified');
  for (const [phase, scenarios] of Object.entries(TASK06_SCENARIOS)) {
    const record = evidence[phase]; const digest = phase === 'cloud' ? snapshot.cloudBuildSha256 : phase === 'device' ? snapshot.deviceBuildSha256 : snapshot.clientBuildSha256;
    if (!await proven(record)) blockers.push(`task06-${phase}-acceptance-missing`);
    if (!digest || record?.buildSha256 !== digest) blockers.push(`task06-${phase}-build-drift`);
    for (const scenario of scenarios) if (!await proven(record?.scenarios?.[scenario])) blockers.push(`task06-${phase}-scenario:${scenario}`);
  }
  return blockers;
}
