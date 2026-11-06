import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { walk } from './check-boundaries.mjs';

export const TASK02_SCENARIOS = {
  local: ['full-check'],
  cloud: [
    'A-content-pass', 'A-content-reject', 'A-content-unavailable',
    'B-same-request', 'B-conflicting-payload', 'B-different-request', 'B-cross-uid',
    'C-primary-key', 'C-rollback-family', 'C-rollback-member', 'C-rollback-receipt', 'C-commit-ack-lost', 'C-sdk-shapes',
    ...['families', 'family_members', 'mutation_receipts', 'request_limits'].flatMap(collection => ['read', 'create', 'update', 'delete'].map(operation => `D-clientdb-${collection}-${operation}`)),
    'D-forged-token', 'D-expired-token', 'D-extra-fields', 'D-create-quota', 'D-user-current-quota', 'D-family-current-quota', 'D-window-recovery', 'D-cross-instance',
    'E-sdk-response-lost', 'E-reopen-current', 'E-normal-artifact', 'E-probe-cleanup',
  ],
  device: ['F-two-accounts', 'F-reopen', 'F-weak-network', 'F-existing-family', 'F-unauthenticated-route', 'F-late-response', 'F-account-isolation'],
};

const slash = path => path.split('\\').join('/');
const secretConfig = path => /(?:^|\/)uni-config-center\/.*\/config\.json$/.test(slash(path));

/** Sorted relative path + NUL + original bytes + NUL, without reading secret config. */
export async function treeSha256(directory, files = undefined) {
  const paths = (files ?? await walk(directory)).filter(path => !secretConfig(path));
  if (!paths.length) return null;
  paths.sort((left, right) => {
    const a = slash(relative(directory, left)); const b = slash(relative(directory, right));
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const digest = createHash('sha256');
  for (const path of paths) digest.update(slash(relative(directory, path))).update('\0').update(await readFile(path)).update('\0');
  return digest.digest('hex');
}

export async function task02Snapshot({ root }) {
  const source = [...await walk(join(root, 'src')), ...await walk(join(root, 'uniCloud-alipay')), ...await walk(join(root, 'cloud-policies'))];
  for (const name of ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.cloud.json', 'vite.config.ts', 'ops/task02-upload-scope.json']) {
    const path = join(root, name);
    try { if ((await stat(path)).isFile()) source.push(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const cloudRoot = join(root, 'dist/task02-normal-cloud');
  const cloud = await walk(cloudRoot);
  const normal = [...source, ...cloud, ...await walk(join(root, 'dist/build/mp-weixin'))];
  const probes = normal.filter(path => /(?:task02-probe|tests[\\/]cloud|(?:^|[\\/])(?:probe|fixture)[-.])/i.test(path));
  // A test object with an unanticipated name must also prevent readiness.
  for (const path of normal.filter(path => /[\\/]index\.obj\.[jt]s$/.test(path))) {
    if (!/[\\/](?:uni-id-co|account-co|family-co)[\\/]index\.obj\.[jt]s$/.test(path)) probes.push(path);
  }
  return {
    sourceSha256: await treeSha256(root, source),
    clientBuildSha256: await treeSha256(join(root, 'dist/build/mp-weixin')),
    cloudBuildSha256: await treeSha256(cloudRoot),
    probeRemnants: [...new Set(probes.map(path => slash(relative(root, path))))].sort(),
  };
}

export async function task02Readiness({ root, evidence, target }) {
  const blockers = [];
  if (!evidence || evidence.ticket !== 'task02' || evidence.version !== 1) return ['task02-acceptance-missing'];
  if (!target || JSON.stringify(evidence.target) !== JSON.stringify(target)) blockers.push('task02-target-mismatch');
  const snapshot = await task02Snapshot({ root });
  if (!snapshot.sourceSha256 || evidence.sourceSha256 !== snapshot.sourceSha256) blockers.push('task02-source-drift');
  if (!snapshot.clientBuildSha256) blockers.push('task02-client-artifact-missing');
  if (!snapshot.cloudBuildSha256) blockers.push('task02-cloud-artifact-missing');
  if (snapshot.probeRemnants.length) blockers.push('task02-probe-remnants');
  async function proven(record) {
    if (record?.status !== 'passed' || typeof record.evidenceRef !== 'string' || !record.evidenceRef.trim()
      || typeof record.evidenceFile !== 'string' || !/^ops\/task02-[a-z0-9-]+\.md$/.test(record.evidenceFile)) return false;
    try { return (await stat(join(root, record.evidenceFile))).isFile() && (await readFile(join(root, record.evidenceFile), 'utf8')).trim().length > 0; }
    catch { return false; }
  }
  const artifact = evidence.cloudArtifact;
  if (!(await proven(artifact)) || !snapshot.cloudBuildSha256 || artifact.buildSha256 !== snapshot.cloudBuildSha256 || artifact.sourceSha256 !== snapshot.sourceSha256) blockers.push('task02-normal-cloud-artifact-unverified');
  if (!(await proven(evidence.cleanup)) || evidence.cleanup.verified !== true || !Array.isArray(evidence.cleanup.remaining) || evidence.cleanup.remaining.length) blockers.push('task02-probe-cleanup-unverified');
  for (const [phase, scenarios] of Object.entries(TASK02_SCENARIOS)) {
    const record = evidence[phase];
    if (!(await proven(record))) blockers.push(`task02-${phase}-acceptance-missing`);
    const digest = phase === 'cloud' ? snapshot.cloudBuildSha256 : snapshot.clientBuildSha256;
    if (!digest || record?.buildSha256 !== digest) blockers.push(`task02-${phase}-build-drift`);
    for (const scenario of scenarios) if (!(await proven(record?.scenarios?.[scenario]))) blockers.push(`task02-${phase}-scenario:${scenario}`);
  }
  return blockers;
}
