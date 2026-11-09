import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { task02Readiness } from './task02-state.mjs';
import { task03Readiness } from './task03-state.mjs';
import { task04Readiness } from './task04-state.mjs';
import { task05Readiness } from './task05-state.mjs';
async function load(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
/** @param {{root:string,ticket?:'task02'|'task03'|'task04'|'task05'}} options */
export async function doctor({ root, ticket }) {
  if (ticket !== undefined && !['task02', 'task03', 'task04', 'task05'].includes(ticket)) throw new Error('Unknown doctor ticket');
  const blockers = []; const target = await load(join(root, 'ops/project-target.json'));
  if (!target) blockers.push('target-missing');
  else {
    const roots = { alipay: 'uniCloud-alipay', aliyun: 'uniCloud-aliyun', tencent: 'uniCloud-tcb' };
    const keys = ['provider', 'cloudRoot', 'spaceId', 'spaceAppId', 'dcloudAppId', 'weixinAppId'];
    if (target.cloudRoot !== roots[target.provider] || Object.keys(target).some(k => !keys.includes(k)) || keys.some(k => typeof target[k] !== 'string' || !target[k])) blockers.push('target-invalid');
  }
  if (ticket === 'task02' || ticket === 'task03' || ticket === 'task04' || ticket === 'task05') {
    const evidence = await load(join(root, `ops/${ticket}-acceptance.json`));
    blockers.push(...await ({ task02: task02Readiness, task03: task03Readiness, task04: task04Readiness, task05: task05Readiness }[ticket])({ root, evidence, target }));
    return { ready: blockers.length === 0, blockers };
  }
  const evidence = await load(join(root, 'ops/acceptance.json'));
  if (!evidence?.runtime?.verified) blockers.push('cloud-runtime-unknown');
  if (!evidence?.region?.verified) blockers.push('cloud-region-unknown');
  if (!evidence?.existingResources?.verified) blockers.push('existing-resources-unknown');
  for (const [name, code] of [['cloud', 'cloud-acceptance-missing'], ['device', 'device-acceptance-missing']]) {
    const item = evidence?.[name];
    if (!item || item.status !== 'passed' || typeof item.evidenceFile !== 'string' || !/^ops\/[a-z0-9-]+\.md$/.test(item.evidenceFile)) { blockers.push(code); continue; }
    try { if ((await stat(join(root, item.evidenceFile))).size === 0) blockers.push(code); } catch { blockers.push(code); }
  }
  // Presence/state only: never print or parse secret configuration contents.
  if (!evidence?.secretConfiguration?.verified) blockers.push('secret-configuration-unverified');
  return { ready: blockers.length === 0, blockers };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--ticket');
  if (index >= 0 && !process.argv[index + 1]) throw new Error('Missing doctor ticket');
  const ticket = index < 0 ? undefined : process.argv[index + 1];
  if (ticket !== undefined && !['task02', 'task03', 'task04', 'task05'].includes(ticket)) throw new Error('Unknown doctor ticket');
  const result = await doctor({ root: fileURLToPath(new URL('../', import.meta.url)), ticket });
  console.log(JSON.stringify({ status: result.ready ? 'READY' : 'NON-READY', ...result }, null, 2));
  if (!result.ready) process.exitCode = 1;
}
