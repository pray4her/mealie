import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { walk } from './check-boundaries.mjs';
import { treeSha256 } from './task02-state.mjs';

export const TASK08_SCENARIOS = {
  local: ['full-check', 'idempotency-quota', 'cancel-lease-membership', 'retry-budget-disable', 'commit-unknown', 'hostile-output', 'cold-start-replay', 'polling-session-isolation'],
  provider: ['pinned-model-schema', 'real-token-cost-request-id', 'safe-errors-no-secret-logs'],
  cloud: ['resource-diff', 'secret-presence-only', 'private-minute-timer', 'closed-page-completion', 'atomic-save', 'text-retention-cleanup'],
  device: ['paste-submit', 'close-reopen-status', 'weak-network-replay', 'hidden-poll-stop', 'cancel', 'open-edit-saved', 'account-generation-isolation'],
};
export async function task08Snapshot({ root }) {
  const source = [];
  for (const folder of ['src', 'uniCloud-alipay', 'cloud-policies', 'scripts', 'tests']) source.push(...await walk(join(root, folder)));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'Taskfile.yml', 'tsconfig.json', 'tsconfig.cloud.json', 'tsconfig.tests.json', 'vite.config.ts', 'vitest.config.ts', 'ops/project-target.json']) {
    const path = join(root, name); try { if ((await stat(path)).isFile()) source.push(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { sourceSha256: await treeSha256(root, source), clientBuildSha256: await treeSha256(join(root, 'dist/build/mp-weixin')),
    cloudBuildSha256: await treeSha256(join(root, 'dist/task08-normal-cloud')), deviceBuildSha256: await treeSha256(join(root, 'dist/task08-device/mp-weixin')) };
}
export async function task08Readiness({ root, evidence, target }) {
  if (!evidence || evidence.ticket !== 'task08' || evidence.version !== 1) return ['task08-acceptance-missing'];
  const blockers = []; const snapshot = await task08Snapshot({ root });
  if (JSON.stringify(target) !== JSON.stringify(evidence.target)) blockers.push('task08-target-mismatch');
  if (!snapshot.sourceSha256 || snapshot.sourceSha256 !== evidence.sourceSha256) blockers.push('task08-source-drift');
  async function proven(record, phase) {
    if (record?.status !== 'passed' || record.mode !== (phase === 'local' ? 'automated' : 'real') || typeof record.evidenceFile !== 'string' || !/^ops\/task08-[a-z0-9-]+\.md$/.test(record.evidenceFile)) return false;
    try { return !!(await readFile(join(root, record.evidenceFile), 'utf8')).trim(); } catch { return false; }
  }
  for (const [phase, scenarios] of Object.entries(TASK08_SCENARIOS)) {
    const record = evidence[phase]; const digest = snapshot[phase === 'local' ? 'clientBuildSha256' : phase === 'device' ? 'deviceBuildSha256' : 'cloudBuildSha256'];
    if (!await proven(record, phase)) blockers.push('task08-' + phase + '-acceptance-pending');
    if (!digest || digest !== record?.buildSha256) blockers.push('task08-' + phase + '-artifact-unverified');
    for (const scenario of scenarios) if (!await proven(record?.scenarios?.[scenario], phase)) blockers.push('task08-' + phase + '-scenario:' + scenario);
  }
  return blockers;
}
