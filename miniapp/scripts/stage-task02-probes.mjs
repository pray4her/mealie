import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeSha256 } from './task02-state.mjs';

// Source artifact only. HBuilderX compilation and the normal deployed module hashes remain pending.
const entry = `const { createRequireIdentity, createUniIdPorts, createDatabasePort, now } = require('home-kernel');
const { createWeixinContentPort } = require('home-family');
const { createTask02Probes } = require('./task02-probes');
const { safeCheckError } = require('./task02-client-checks');
const config = require('./probe-config.json');
const operations = ['rollback-family', 'rollback-member', 'rollback-receipt', 'commit-ack-lost', 'primary-key', 'counts', 'consume-current', 'prefill-family-current', 'cleanup', 'sdk-shapes'];
module.exports = {
  async run(input) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !operations.includes(input.operation)) return { scenario: 'probe', passed: false, errorCode: 'INVALID_INPUT' };
      const info = this.getClientInfo(); const token = this.getUniIdToken();
      if (info.appId !== '__UNI__5FDC0D7' || info.uniPlatform !== 'mp-weixin') return { scenario: 'probe', passed: false, errorCode: 'AUTH_REQUIRED' };
      const guard = createRequireIdentity({ ...createUniIdPorts(info), now });
      const identity = await guard(token, info, { refresh: false });
      // Empty actor list rejects everyone. Neither uid nor record IDs come from input.
      const actor = config.actors.find(candidate => candidate.uid === identity.uid);
      if (!actor || !actor.allowedOperations.includes(input.operation)) return { scenario: 'probe', passed: false, errorCode: 'FORBIDDEN' };
      const platform = uniCloud.database();
      const revalidateIdentity = async () => { const current = await guard(token, info, { refresh: false }); if (current.uid !== identity.uid) throw new Error('Identity changed'); };
      const probe = createTask02Probes({ identity, scope: actor.scope, now, revalidateIdentity,
        database: createDatabasePort(platform, { maxAttempts: 3, conflictCodes: config.verifiedConflictCodes, backoff: async () => {} }),
        content: createWeixinContentPort({ uid: identity.uid, appId: info.appId, requestId: this.getUniCloudRequestId(),
          async readOpenid(uid) {
            const response = await platform.collection('uni-id-users').doc(uid).field({ wx_openid: true }).get();
            if (!response || !Array.isArray(response.data) || response.data.length !== 1) throw new Error('Unavailable');
            return response.data[0].wx_openid;
          },
        }),
      });
      if (input.operation.startsWith('rollback-')) return probe.failure(input.operation.slice(9));
      if (input.operation === 'commit-ack-lost') return probe.failure('commit-ack-lost');
      if (input.operation === 'primary-key') return probe.primaryKey();
      if (input.operation === 'counts') return { scenario: 'allowlist-point-counts', passed: true, counts: await probe.counts() };
      if (input.operation === 'consume-current') return probe.consumeCurrent();
      if (input.operation === 'prefill-family-current') return probe.prefillFamilyCurrent();
      if (input.operation === 'cleanup') return probe.cleanup();
      if (input.operation === 'sdk-shapes') {
        const id = actor.scope.familyIds[0];
        const shape = value => value === null ? 'null' : Array.isArray(value) ? 'array:' + value.length : typeof value;
        const successfulObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (!('errCode' in value) || value.errCode === 0);
        const ordinary = await platform.collection('families').doc(id).get();
        const tx = await platform.startTransaction();
        let point; let commit;
        try { point = await tx.collection('families').doc(id).get(); commit = await tx.commit(); }
        catch (error) { try { await tx.rollback(); } catch {} throw error; }
        const shapes = { ordinaryData: shape(ordinary.data), transactionData: shape(point.data), commit: shape(commit) };
        return { scenario: 'C-sdk-shapes', passed: successfulObject(ordinary) && successfulObject(point) && shapes.ordinaryData === 'array:0' && shapes.transactionData === 'null' && (commit === undefined || successfulObject(commit)), shapes };
      }
    } catch (error) {
      // No exception messages, rows, openids, tokens or SDK payloads leave the probe.
      return { scenario: 'probe', passed: false, errorCode: safeCheckError(error) };
    }
  },
};
`;

export async function stageTask02Probes({ root, parent = join(tmpdir(), 'opencode') }) {
  const safeParent = resolve(tmpdir(), 'opencode'); const requested = resolve(parent);
  if (requested !== safeParent && !requested.startsWith(safeParent + sep)) throw new Error('Probe output must stay in the session temporary directory');
  await mkdir(requested, { recursive: true });
  const actual = await realpath(requested);
  const safeActual = await realpath(safeParent);
  if (actual !== safeActual && !actual.startsWith(safeActual + sep)) throw new Error('Probe temporary path escape');
  const directory = await mkdtemp(join(actual, 'task02-probes-'));
  const objects = [];
  for (const name of ['task02-probe-a', 'task02-probe-b']) {
    const path = join('uniCloud-alipay/cloudfunctions', name); const target = join(directory, path);
    await mkdir(target, { recursive: true });
    for (const file of ['task02-probes', 'task02-client-checks']) {
      const source = await readFile(join(root, 'tests/cloud', `${file}.ts`), 'utf8');
      const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
      if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error('Probe TypeScript compilation failed');
      await writeFile(join(target, `${file}.js`), result.outputText);
    }
    await writeFile(join(target, 'index.obj.js'), entry);
    await writeFile(join(target, 'probe-config.json'), JSON.stringify({ actors: [], verifiedConflictCodes: [] }, null, 2) + '\n');
    await writeFile(join(target, 'package.json'), JSON.stringify({ name, version: '0.0.0', private: true, main: 'index.obj.js', dependencies: { 'home-kernel': 'file:../common/home-kernel', 'home-family': 'file:../common/home-family' } }, null, 2) + '\n');
    objects.push({ name, path: path.split(sep).join('/'), sourceSha256: await treeSha256(target), hashKind: 'relative-path-nul-bytes-nul-sha256' });
  }
  const manifest = {
    ticket: 'task02', purpose: 'isolated-test-source-artifact', uploadAuthorized: false, actorBindingComplete: false, compiledCloudArtifactSha256: null,
    objects,
    commonSourceDigests: Object.fromEntries(await Promise.all(['home-contracts', 'home-kernel', 'home-family'].map(async name => [name, await treeSha256(join(root, 'uniCloud-alipay/cloudfunctions/common', name))]))),
    commonArtifactPolicy: 'Use the SAME HBuilderX-built common modules as normal family-co; never substitute fixture or separately patched business implementations. Verify compiled hashes at acceptance.',
    recordScope: { status: 'pending-real-actor-binding', actorUids: [], familyIds: [], generationIds: [], requestIds: [], receiptIds: [], quotaBucketIds: [] },
    cleanup: { objectNames: ['task02-probe-a', 'task02-probe-b'], records: 'Exact server-bound IDs only after separately approved record inventory; no collection-wide removal', allowCollectionDelete: false, verified: false },
  };
  await writeFile(join(directory, 'task02-probe-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory, manifest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await stageTask02Probes({ root: fileURLToPath(new URL('../', import.meta.url)) });
  console.log(JSON.stringify({ directory: result.directory, ...result.manifest }, null, 2));
}
