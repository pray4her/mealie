/* global fetch, AbortSignal */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import ts from "typescript";
const require = createRequire(import.meta.url);
const [directory, bundlePath, sdkPath, operation = "client"] = process.argv.slice(2);
assert.ok(directory && bundlePath && sdkPath, "Usage: node scripts/run-task07-storage-checks.mjs SESSION_DIR LINKED_BUNDLE OFFICIAL_SDK [client|cloud-seed|cloud-roundtrip|cloud-cleanup|verify-removed|retired]");
assert.ok(['client', 'cloud-seed', 'cloud-roundtrip', 'cloud-cleanup', 'verify-removed', 'retired'].includes(operation), 'Unknown probe operation');
const session = JSON.parse(fs.readFileSync(path.join(directory, "session.local.json"), "utf8"));
assert.equal(session.target.provider, "alipay");
assert.equal(session.target.spaceId, "env-00jy7289et7b");
assert.match(session.prefix, /^task07-private\/task07-probe-[a-f0-9]{12}$/);
const source = fs.readFileSync(bundlePath, "utf8");
const tree = ts.createSourceFile('vendor.js', source, ts.ScriptTarget.Latest, true);
let configs;
// shortcut: this decodes the current HBuilderX numeric wrapper; update it if that emitted format changes.
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && node.initializer.getText(tree).includes('fromCharCode') && node.initializer.getText(tree).length < 5000) {
    try {
      const value = vm.runInNewContext(node.initializer.getText(tree), { JSON, String, k: value => value && typeof value === 'string' ? JSON.parse(value) : value }, { timeout: 1000 });
      if (Array.isArray(value) && value.some(item => item?.provider === 'alipay' && item?.spaceId === session.target.spaceId)) configs = value;
    } catch { /* Other numeric wrappers may belong to unrelated SDK data. */ }
  }
  ts.forEachChild(node, walk);
}
walk(tree);
assert.ok(configs, 'Linked public client configuration was not found');
const config = configs.find(item => item.provider === 'alipay' && item.spaceId === session.target.spaceId);
const requests = [];
globalThis.uni = {
  getStorageSync: () => '', setStorageSync: () => {}, removeStorageSync: () => {},
  getLocale: () => 'en',
  getSystemInfoSync: () => ({ platform: 'devtools', uniPlatform: 'mp-weixin', appId: session.target.dcloudAppId, deviceId: 'task07-synthetic-client' }),
  request(options) {
    requests.push({ method: options.method, headerNames: Object.keys(options.header || {}), businessTokenPresent: String(options.data || '').includes('uniIdToken') });
    fetch(options.url, { method: options.method, headers: options.header, body: options.method === 'GET' ? undefined : options.data,
      signal: AbortSignal.timeout(30000), redirect: 'error' }).then(async response => {
      let data; try { data = await response.json(); } catch { data = {}; }
      const result = { statusCode: response.status, data, header: Object.fromEntries(response.headers), errMsg: 'request:ok' };
      options.success?.(result); options.complete?.(result);
    }).catch(() => { const result = { errMsg: 'request:fail' }; options.fail?.(result); options.complete?.(result); });
    return { abort() {} };
  },
};
globalThis.wx = { canIUse: () => false };
process.env.UNI_PLATFORM = 'mp-weixin';
process.env.UNI_APP_ID = session.target.dcloudAppId;
const client = require(sdkPath).uniCloud.init(config);
const ids = [`cloud://${config.spaceId}/${session.prefix}/sample.png`, `cloud://${config.spaceId}/${session.prefix}/nested/sample.png`];
async function read(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function main() {
  if (operation === 'cloud-seed') {
    const response = await client.callFunction({ name: session.name, data: { operation: 'seed', capability: session.capability } });
    assert.equal(response.result.ok, true);
    const report = { recordedAt: new Date().toISOString(), requestId: response.requestId, ...response.result };
    fs.writeFileSync(path.join(directory, 'seed-results.sanitized.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); return;
  }
  if (operation === 'cloud-roundtrip') {
    const inspect = await client.callFunction({ name: session.name, data: { operation: 'inspect', capability: session.capability } });
    const signed = await client.callFunction({ name: session.name, data: { operation: 'sign', capability: session.capability } });
    assert.equal(inspect.result.ok, true); assert.equal(signed.result.ok, true);
    fs.writeFileSync(path.join(directory, 'server-links.local.json'), JSON.stringify(signed.result));
    const links = [];
    for (const link of signed.result.links) links.push({ fileID: link.fileID, response: await read(link.tempFileURL) });
    const report = { recordedAt: new Date().toISOString(), inspect: { requestId: inspect.requestId, ...inspect.result },
      sign: { requestId: signed.requestId, issuedAt: signed.result.issuedAt, links } };
    fs.writeFileSync(path.join(directory, 'cloud-results.sanitized.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); return;
  }
  if (operation === 'cloud-cleanup') {
    const response = await client.callFunction({ name: session.name, data: { operation: 'cleanup', capability: session.capability } });
    const oldLinks = JSON.parse(fs.readFileSync(path.join(directory, 'client-links.local.json'), 'utf8'));
    const links = [];
    for (const link of oldLinks.fileList) links.push({ fileID: link.fileID, response: await read(link.tempFileURL) });
    const report = { recordedAt: new Date().toISOString(), requestId: response.requestId, ...response.result, oldSignedLinks: links };
    fs.writeFileSync(path.join(directory, 'cleanup-results.sanitized.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); return;
  }
  if (operation === 'retired') {
    const response = await client.callFunction({ name: session.name, data: { operation: 'inspect', capability: session.capability } });
    assert.deepEqual(response.result, { ok: false, errorCode: 'PROBE_RETIRED' });
    const report = { recordedAt: new Date().toISOString(), requestId: response.requestId, ...response.result };
    fs.writeFileSync(path.join(directory, 'retirement-results.sanitized.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); return;
  }
  if (operation === 'verify-removed') {
    const previous = JSON.parse(fs.readFileSync(path.join(directory, 'client-links.local.json'), 'utf8'));
    const files = [];
    for (const link of previous.fileList) {
      const expiresAt = Number(new URL(link.tempFileURL).searchParams.get('expire_at')) * 1000;
      assert.ok(Number.isFinite(expiresAt) && expiresAt > Date.now(), 'Removal must be checked before the old signed URL expires');
      const response = await read(link.tempFileURL);
      assert.equal(response.status, 404, 'Storage object removal is not confirmed');
      files.push({ fileID: link.fileID, status: response.status });
    }
    const report = { recordedAt: new Date().toISOString(), removed: true, files };
    fs.writeFileSync(path.join(directory, 'removal-results.sanitized.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2)); return;
  }
  const response = await client.getTempFileURL({ fileList: ids });
  assert.equal(response.fileList.length, 2);
  fs.writeFileSync(path.join(directory, 'client-links.local.json'), JSON.stringify(response));
  const results = [];
  for (const link of response.fileList) {
    const url = new URL(link.tempFileURL); const raw = new URL(url); raw.search = '';
    const signed = await read(url); const anonymous = await read(raw);
    results.push({ fileID: link.fileID, signed, anonymous, queryKeys: [...url.searchParams.keys()],
      signedBytesMatch: signed.sha256 === createHash('sha256').update(Buffer.from(session.sampleBase64, 'base64')).digest('hex') });
  }
  const report = { recordedAt: new Date().toISOString(), target: { provider: config.provider, spaceId: config.spaceId },
    clientSource: 'HBuilderX installed official uniCloud SDK; public linked development bundle configuration only',
    publicBundleSha256: createHash('sha256').update(source).digest('hex'),
    officialSdkSha256: createHash('sha256').update(fs.readFileSync(sdkPath)).digest('hex'),
    privateReadByAnonymousClient: results.some(result => result.signedBytesMatch),
    businessSession: 'empty isolated storage; no uni-id token', requests, results };
  fs.writeFileSync(path.join(directory, 'client-results.sanitized.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
  const code = error.errCode || error.code;
  console.log(JSON.stringify({ ok: false, errorCode: 'PROBE_EXECUTION_FAILED',
    ...(typeof code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(code) ? { platformCode: code } : {}) }));
  process.exitCode = 1;
});
