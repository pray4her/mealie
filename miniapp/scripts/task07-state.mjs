import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from './check-boundaries.mjs';
import { treeSha256 } from './task02-state.mjs';

export const TASK07_SCENARIOS = {
  local: ['full-check', 'media-domain', 'encrypted-callback-contract', 'storage-adapter-contract', 'page-independent-save', 'hidden-session-isolation'],
  cloud: ['upload-read-bind', 'file-integrity', 'anonymous-original-url', 'client-sdk-link', 'client-overwrite-delete', 'actual-expiry', 'membership-revocation', 'callback-configuration', 'cleanup-inventory'],
  device: ['select-cancel', 'jpeg-png-preview', 'independent-save-draft', 'weak-network-recovery', 'hidden-response', 'logout-account-switch'],
};
export async function task07Snapshot({ root }) {
  const source = [];
  for (const folder of ['src', 'uniCloud-alipay', 'cloud-policies', 'scripts', 'tests']) source.push(...await walk(join(root, folder)));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'Taskfile.yml', 'tsconfig.json', 'tsconfig.cloud.json', 'tsconfig.tests.json', 'vite.config.ts', 'vitest.config.ts', 'ops/project-target.json']) {
    const path = join(root, name); try { if ((await stat(path)).isFile()) source.push(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { sourceSha256: await treeSha256(root, source), clientBuildSha256: await treeSha256(join(root, 'dist/build/mp-weixin')),
    cloudBuildSha256: await treeSha256(join(root, 'dist/task07-normal-cloud')), deviceBuildSha256: await treeSha256(join(root, 'dist/task07-device/mp-weixin')) };
}
export async function task07Readiness({ root, evidence, target }) {
  if (!evidence || evidence.ticket !== 'task07' || evidence.version !== 1) return ['task07-acceptance-missing'];
  const blockers = []; const snapshot = await task07Snapshot({ root });
  if (JSON.stringify(target) !== JSON.stringify(evidence.target)) blockers.push('task07-target-mismatch');
  if (!snapshot.sourceSha256 || snapshot.sourceSha256 !== evidence.sourceSha256) blockers.push('task07-source-drift');
  async function proven(record, phase) {
    if (record?.status !== 'passed' || record.mode !== (phase === 'local' ? 'automated' : 'real') || typeof record.evidenceFile !== 'string' || !/^ops\/task07-[a-z0-9-]+\.md$/.test(record.evidenceFile)) return false;
    try { return !!(await readFile(join(root, record.evidenceFile), 'utf8')).trim(); } catch { return false; }
  }
  for (const [phase, scenarios] of Object.entries(TASK07_SCENARIOS)) {
    const record = evidence[phase]; const digest = snapshot[phase === 'local' ? 'clientBuildSha256' : phase === 'cloud' ? 'cloudBuildSha256' : 'deviceBuildSha256'];
    if (!await proven(record, phase)) blockers.push('task07-' + phase + '-acceptance-pending');
    if (!digest || digest !== record?.buildSha256) blockers.push('task07-' + phase + '-artifact-unverified');
    for (const scenario of scenarios) if (!await proven(record?.scenarios?.[scenario], phase)) blockers.push('task07-' + phase + '-scenario:' + scenario);
  }
  return blockers;
}
