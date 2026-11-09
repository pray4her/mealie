import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { doctor } from '../../scripts/doctor.mjs';
import { task02Snapshot, TASK02_SCENARIOS } from '../../scripts/task02-state.mjs';
import { createDeployPreview } from '../../scripts/deploy-preview.mjs';
import { testDirectory } from '../support/temp-directory';
import { createHarness } from '../support/harness';
import { runTask02Checks, checkTask02Race, safeCheckError } from '../cloud/task02-client-checks';
import { createTask02Probes } from '../cloud/task02-probes';
import { createMemoryDatabase } from '../support/memory-database';
import { stageTask02Probes } from '../../scripts/stage-task02-probes.mjs';
import { runInNewContext } from 'node:vm';
import * as kernel from 'home-kernel';
import { createWeixinContentPort } from 'home-family';

test('task02 does not inherit the historical task01 acceptance', async () => {
  const root = await testDirectory('task02-ops-');
  await mkdir(join(root, 'ops'));
  await writeFile(join(root, 'ops/project-target.json'), JSON.stringify({ provider: 'alipay', cloudRoot: 'uniCloud-alipay', spaceId: 'env-test', spaceAppId: 'app', dcloudAppId: 'dcloud', weixinAppId: 'weixin' }));
  await writeFile(join(root, 'ops/old.md'), 'Historical acceptance only.');
  await writeFile(join(root, 'ops/acceptance.json'), JSON.stringify({ runtime: { verified: true }, region: { verified: true }, existingResources: { verified: true }, secretConfiguration: { verified: true }, cloud: { status: 'passed', evidenceFile: 'ops/old.md' }, device: { status: 'passed', evidenceFile: 'ops/old.md' } }));
  expect((await doctor({ root })).ready).toBe(true);
  const result = await doctor({ root, ticket: 'task02' });
  expect(result.ready).toBe(false);
  expect(result.blockers).toContain('task02-acceptance-missing');
});

async function acceptedFixture(full = false) {
  const root = await testDirectory('task02-accepted-');
  await mkdir(join(root, 'ops'));
  if (full) {
    for (const path of ['src', 'uniCloud-alipay', 'dist/build/mp-weixin']) await cp(path, join(root, path), { recursive: true, filter: source => !/[/\\]uni-config-center[/\\].*[/\\]config\.json$/.test(source) });
  } else {
    for (const path of ['src', 'uniCloud-alipay/cloudfunctions/family-co', 'dist/build/mp-weixin']) await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, 'src/client.ts'), 'export const client = true;');
    await writeFile(join(root, 'uniCloud-alipay/cloudfunctions/family-co/index.obj.ts'), 'export function current() {}');
    await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'client();');
  }
  await writeFile(join(root, 'ops/project-target.json'), await readFile('ops/project-target.json'));
  await writeFile(join(root, 'ops/task02-proof.md'), 'Synthetic gate fixture: all checks were observed in this test only.');
  // A stand-in compiled artifact only for exercising the offline evidence gate.
  for (const name of ['uni-id-co', 'account-co', 'family-co']) {
    const path = join(root, 'dist/task02-normal-cloud/cloudfunctions', name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'index.obj.js'), 'module.exports = {};');
  }
  const snapshot = await task02Snapshot({ root });
  const evidenceFile = 'ops/task02-proof.md';
  const record = { status: 'passed', evidenceFile, evidenceRef: 'synthetic-gate-fixture' };
  const acceptance = {
    ticket: 'task02', version: 1,
    target: JSON.parse(await readFile(join(root, 'ops/project-target.json'), 'utf8')),
    sourceSha256: snapshot.sourceSha256,
    cloudArtifact: { ...record, buildSha256: snapshot.cloudBuildSha256, sourceSha256: snapshot.sourceSha256 },
    cleanup: { ...record, verified: true, remaining: [] },
    local: { ...record, buildSha256: snapshot.clientBuildSha256, scenarios: Object.fromEntries(TASK02_SCENARIOS.local.map(name => [name, { ...record }])) },
    cloud: { ...record, buildSha256: snapshot.cloudBuildSha256, scenarios: Object.fromEntries(TASK02_SCENARIOS.cloud.map(name => [name, { ...record }])) },
    device: { ...record, buildSha256: snapshot.clientBuildSha256, scenarios: Object.fromEntries(TASK02_SCENARIOS.device.map(name => [name, { ...record }])) },
  };
  const save = () => writeFile(join(root, 'ops/task02-acceptance.json'), JSON.stringify(acceptance));
  await save();
  return { root, acceptance, save };
}

test('task02 requires each real scenario and evidence file with the matching build', async () => {
  const { root, acceptance, save } = await acceptedFixture();
  expect(await doctor({ root, ticket: 'task02' })).toEqual({ ready: true, blockers: [] });
  delete acceptance.cloud.scenarios['A-content-reject']; await save();
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-cloud-scenario:A-content-reject');
  acceptance.cloud.scenarios['A-content-reject'] = { status: 'passed', evidenceFile: 'ops/task02-nonexistent.md', evidenceRef: 'not-real' }; await save();
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-cloud-scenario:A-content-reject');
  acceptance.device.buildSha256 = '0'.repeat(64); await save();
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-device-build-drift');
});

test('task02 invalidates evidence after source or normal artifact changes', async () => {
  const { root } = await acceptedFixture();
  await writeFile(join(root, 'src/changed.ts'), 'export const changed = true;');
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-source-drift');
  await writeFile(join(root, 'dist/task02-normal-cloud/cloudfunctions/family-co/index.obj.js'), 'module.exports = { changed: true };');
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-cloud-build-drift');
  await writeFile(join(root, 'dist/build/mp-weixin/app.js'), 'changed();');
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-device-build-drift');
});

test('task02 refuses a locally remaining test object and unconfirmed remote cleanup', async () => {
  const { root, acceptance, save } = await acceptedFixture();
  acceptance.cleanup.verified = false; await save();
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-probe-cleanup-unverified');
  const probe = join(root, 'dist/task02-normal-cloud/cloudfunctions/unexpected-object');
  await mkdir(probe); await writeFile(join(probe, 'index.obj.js'), 'module.exports = {};');
  expect((await doctor({ root, ticket: 'task02' })).blockers).toContain('task02-probe-remnants');
});

test('task02 dry preview does not change files, associate, upload or initialize', async () => {
  const { root } = await acceptedFixture(true);
  const before = await task02Snapshot({ root });
  const historical = await readFile('ops/acceptance.json', 'utf8');
  const preview = await createDeployPreview({ root, ticket: 'task02' });
  expect(preview).toMatchObject({ ticket: 'task02', previewOnly: true, uploadAuthorized: false, blocked: true });
  expect(preview.resources).toHaveLength(35);
  expect(preview.resources.every(item => item.action === 'blocked-no-upload')).toBe(true);
  expect(await task02Snapshot({ root })).toEqual(before);
  expect(await readFile('ops/acceptance.json', 'utf8')).toBe(historical);
});

test('SDK acceptance helper checks same-request replay without emitting identity or secrets', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'private-test-uid' });
  const results = await runTask02Checks(h.client('private-test-uid'), { sameRequest: { requestId: 'cloud-check-00001', name: '专用测试家庭' }, otherRequest: { requestId: 'cloud-check-00002', name: '另一家庭' } });
  expect(results.every(result => result.passed)).toBe(true);
  expect(results.map(result => result.scenario)).toEqual(['B-same-request', 'B-replay', 'B-other-request-after-create', 'E-current-consistent']);
  expect(JSON.stringify(results)).not.toContain('private-test-uid');
  expect(JSON.stringify(results)).not.toContain('专用测试家庭');
  const second = await runTask02Checks(h.client('private-test-uid'), { sameRequest: { requestId: 'cloud-check-00001', name: '专用测试家庭' }, otherRequest: { requestId: 'cloud-check-00002', name: '另一家庭' } });
  expect(second).toEqual([{ scenario: 'B-fresh-account', passed: false, errorCode: 'FRESH_STATE_REQUIRED' }]);
});

test.each(['different-request', 'conflicting-payload'] as const)('SDK race helper uses a fresh state for %s', async kind => {
  const h = createHarness(); await h.seedIdentity({ uid: 'race-private-uid' });
  const first = { requestId: 'race-check-000001', name: '并发测试家庭' };
  const second = { requestId: kind === 'different-request' ? 'race-check-000002' : first.requestId, name: '第二个测试家庭' };
  expect(await checkTask02Race(h.client('race-private-uid'), [first, second], kind)).toMatchObject({ scenario: `B-${kind}`, passed: true });
  expect(await h.rows('families')).toHaveLength(1);
});

function probeFixture(allowCleanup = false) {
  const memory = createMemoryDatabase();
  const probe = createTask02Probes({
    database: memory.database, identity: { uid: 'private-probe-actor' },
    scope: { uid: 'private-probe-actor', familyIds: ['scoped-family-0001'], generationIds: ['scoped-generation-0001'], requestIds: ['probe-request-00001'], name: '故障测试家庭', allowCleanup },
    content: { async checkText() { return 'allowed'; } }, revalidateIdentity: async () => {}, now: () => 1_800_000_000_000,
  });
  return { memory, probe };
}

test.each(['family', 'member', 'receipt'] as const)('isolated probe really delegates rollback after the %s write', async stage => {
  const { probe, memory } = probeFixture();
  expect(await probe.failure(stage)).toEqual({ scenario: `C-rollback-${stage}`, passed: true, errorCode: 'UNAVAILABLE', counts: { families: 0, members: 0, receipts: 0 } });
  expect(await memory.rows('request_limits')).toHaveLength(1);
});

test('isolated acknowledgement-loss probe commits once and requires exact cleanup authorization', async () => {
  const denied = probeFixture();
  expect(await denied.probe.cleanup()).toMatchObject({ passed: false, errorCode: 'FORBIDDEN' });
  const { probe, memory } = probeFixture(true);
  expect(await probe.failure('commit-ack-lost')).toEqual({ scenario: 'C-commit-ack-lost', passed: true, counts: { families: 1, members: 1, receipts: 1 } });
  expect(await probe.cleanup()).toMatchObject({ passed: true, counts: { families: 0, members: 0, receipts: 0 } });
  expect(await memory.rows('request_limits')).toHaveLength(0);
});

test('probe staging is separate, imports common business modules and defaults to no authorized actors', async () => {
  const root = await testDirectory('task02-probe-source-');
  await cp('tests/cloud', join(root, 'tests/cloud'), { recursive: true });
  await cp('uniCloud-alipay/cloudfunctions/common', join(root, 'uniCloud-alipay/cloudfunctions/common'), { recursive: true });
  const before = await task02Snapshot({ root });
  const staged = await stageTask02Probes({ root, parent: await testDirectory('task02-probe-output-') });
  expect(staged.manifest.objects.map(object => object.name)).toEqual(['task02-probe-a', 'task02-probe-b']);
  expect(staged.manifest).toMatchObject({ uploadAuthorized: false, actorBindingComplete: false, compiledCloudArtifactSha256: null });
  for (const object of staged.manifest.objects) {
    const directory = join(staged.directory, object.path);
    const config = JSON.parse(await readFile(join(directory, 'probe-config.json'), 'utf8'));
    expect(config.actors).toEqual([]);
    expect(await readFile(join(directory, 'task02-probes.js'), 'utf8')).toContain('require("home-family")');
    expect(await readFile(join(directory, 'index.obj.js'), 'utf8')).toContain('refresh: false');
    expect(await readFile(join(directory, 'index.obj.js'), 'utf8')).toContain('candidate.uid === identity.uid');
    const module = { exports: {} as { run(input: unknown): Promise<unknown> } };
    const now = Date.now();
    runInNewContext(await readFile(join(directory, 'index.obj.js'), 'utf8'), {
      module,
      require(name: string) {
        if (name === './probe-config.json') return config;
        if (name === './task02-client-checks') return { safeCheckError: (error: unknown) => error instanceof kernel.AppError ? error.code : 'UNAVAILABLE' };
        if (name === './task02-probes') return { createTask02Probes };
        if (name === 'home-family') return {};
        if (name === 'home-kernel') return { ...kernel, createUniIdPorts: () => ({ tokens: {
          async verify(token: string) { if (token !== 'valid-probe-token') throw new kernel.AppError('AUTH_REQUIRED'); return { uid: 'private-probe-uid', issuedAtSeconds: Math.floor(now / 1000) - 60, expiresAtSeconds: Math.floor(now / 1000) + 3600 }; },
          async refreshIfNeeded() { return null; },
        }, accounts: { async get() { return { status: null, tokens: ['valid-probe-token'], validTokenDateMs: null }; } } }) };
        throw new Error('Unexpected dependency');
      },
      uniCloud: { database() { throw new Error('Unauthorized actor reached database'); } },
    });
    const context = { getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' }), getUniIdToken: () => 'valid-probe-token' };
    expect(await module.exports.run.call(context, { operation: 'counts' })).toMatchObject({ passed: false, errorCode: 'FORBIDDEN' });
    expect(await module.exports.run.call({ ...context, getUniIdToken: () => 'forged' }, { operation: 'cleanup' })).toMatchObject({ passed: false, errorCode: 'AUTH_REQUIRED' });
    expect(await module.exports.run.call(context, { operation: 'counts', uid: 'private-probe-uid' })).toMatchObject({ passed: false, errorCode: 'INVALID_INPUT' });
  }
  expect(await task02Snapshot({ root })).toEqual(before);
});

test('authorized generated sdk-shapes probe accepts valid acknowledgements and rejects SDK failures offline', async () => {
  const staged = await stageTask02Probes({ root: process.cwd(), parent: await testDirectory('task02-sdk-shapes-') });
  const source = await readFile(join(staged.directory, staged.manifest.objects[0].path, 'index.obj.js'), 'utf8');
  const cases: { label: string; commit: unknown; shape: string; passed: boolean; failure?: string }[] = [
    { label: 'fulfilled void', commit: undefined, shape: 'undefined', passed: true },
    { label: 'empty object', commit: {}, shape: 'object', passed: true },
    { label: 'zero SDK code', commit: { errCode: 0 }, shape: 'object', passed: true },
    ...[null, false, 0, '', [], 1, 'ok', { errCode: 1 }, { errCode: '0' }, { errCode: undefined }].map(commit => ({
      label: `malformed acknowledgement ${String(commit)}`, commit,
      shape: commit === null ? 'null' : Array.isArray(commit) ? 'array:0' : typeof commit, passed: false,
    })),
    ...['commit', 'ordinary-code', 'point-code', 'ordinary', 'start', 'point'].map(failure => ({ label: `SDK failure ${failure}`, commit: undefined, shape: 'undefined', passed: false, failure })),
  ];
  for (const fixture of cases) {
    const calls: string[] = []; const now = Date.now(); const uid = 'private-sdk-probe-uid'; const id = 'scoped-family-0001';
    const config = { actors: [{ uid, allowedOperations: ['sdk-shapes'], scope: {
      uid, familyIds: [id], generationIds: ['scoped-generation-0001'], requestIds: ['probe-request-00001'], name: '故障测试家庭', allowCleanup: false,
    } }], verifiedConflictCodes: [] };
    const fail = (stage: string) => { if (fixture.failure === stage) throw new Error('private SDK payload'); };
    const platform = {
      collection(collection: string) { expect(collection).toBe('families'); return { doc(document: string) {
        expect(document).toBe(id); return { async get() { calls.push('ordinary'); fail('ordinary'); return { data: [], ...(fixture.failure === 'ordinary-code' ? { errCode: 1 } : {}) }; } };
      } }; },
      async startTransaction() {
        calls.push('start'); fail('start'); return {
          collection(collection: string) { expect(collection).toBe('families'); return { doc(document: string) {
            expect(document).toBe(id); return { async get() { calls.push('point'); fail('point'); return { data: null, ...(fixture.failure === 'point-code' ? { errCode: 1 } : {}) }; } };
          } }; },
          async commit() { calls.push('commit'); fail('commit'); return fixture.commit; },
          async rollback() { calls.push('rollback'); },
        };
      },
    };
    const module = { exports: {} as { run(input: unknown): Promise<{ passed: boolean; shapes?: Record<string, string> }> } };
    runInNewContext(source, { module, uniCloud: { database: () => platform }, require(name: string) {
      if (name === './probe-config.json') return config;
      if (name === './task02-client-checks') return { safeCheckError };
      if (name === './task02-probes') return { createTask02Probes };
      if (name === 'home-family') return { createWeixinContentPort };
      if (name === 'home-kernel') return { ...kernel, createUniIdPorts: () => ({ tokens: {
        async verify(token: string) { expect(token).toBe('fixture-token'); return { uid, issuedAtSeconds: Math.floor(now / 1000) - 60, expiresAtSeconds: Math.floor(now / 1000) + 3600 }; },
        async refreshIfNeeded() { throw new Error('Probe must not refresh'); },
      }, accounts: { async get() { return { status: null, tokens: ['fixture-token'], validTokenDateMs: null }; } } }) };
      throw new Error('Unexpected dependency');
    } });
    const result = await module.exports.run.call({
      getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' }),
      getUniIdToken: () => 'fixture-token', getUniCloudRequestId: () => 'fixture-request',
    }, { operation: 'sdk-shapes' });
    expect(result.passed, fixture.label).toBe(fixture.passed);
    if (!fixture.failure || fixture.failure.endsWith('-code')) {
      expect(result.shapes, fixture.label).toEqual({ ordinaryData: 'array:0', transactionData: 'null', commit: fixture.shape });
      expect(calls, fixture.label).toEqual(['ordinary', 'start', 'point', 'commit']);
    } else {
      expect(result, fixture.label).toMatchObject({ passed: false, errorCode: 'UNAVAILABLE' });
      if (fixture.failure === 'commit' || fixture.failure === 'point') expect(calls.at(-1)).toBe('rollback');
    }
    expect(JSON.stringify(result)).not.toContain(uid); expect(JSON.stringify(result)).not.toContain('private SDK payload');
  }
});
