import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { treeSha256 } from './task02-state.mjs';

export async function stageTask07StorageProbe({ root }) {
  const target = JSON.parse(await readFile(join(root, 'ops/project-target.json'), 'utf8'));
  if (target.provider !== 'alipay' || target.spaceId !== 'env-00jy7289et7b') throw new Error('Unexpected storage probe target');
  const directory = await mkdtemp(join(tmpdir(), 'mealie-task07-storage-'));
  const nonce = randomBytes(6).toString('hex'); const name = `task07-storage-${nonce}`;
  const path = join(directory, 'uniCloud-alipay/cloudfunctions', name);
  const prefix = `task07-private/task07-probe-${nonce}`;
  const capability = randomBytes(32).toString('hex');
  const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const config = { prefix, spaceId: target.spaceId, sampleBase64, capabilityHash: createHash('sha256').update(capability).digest('hex') };
  const source = await readFile(join(root, 'tests/cloud/task07-storage-probe.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  if (compiled.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('Probe compilation failed');
  await mkdir(path, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), await readFile(join(root, 'src/manifest.json')));
  await writeFile(join(directory, 'pages.json'), JSON.stringify({ pages: [] }));
  await writeFile(join(path, 'task07-storage-probe.js'), compiled.outputText);
  await writeFile(join(path, 'probe-config.json'), JSON.stringify(config, null, 2) + '\n');
  await writeFile(join(path, 'index.js'), `const { createStorageProbe } = require('./task07-storage-probe');
const config = require('./probe-config.json');
exports.main = async input => createStorageProbe({ ...config, cloud: uniCloud, sample: Buffer.from(config.sampleBase64, 'base64') })(input);
`);
  await writeFile(join(path, 'package.json'), JSON.stringify({ name, version: '0.0.0', private: true, main: 'index.js', dependencies: {}, 'cloudfunction-config': { memorySize: 256, timeout: 30 } }, null, 2) + '\n');
  const sourceSha256 = await treeSha256(path);
  // The capability and raw signed URLs stay outside tracked source and the function package.
  await writeFile(join(directory, 'session.local.json'), JSON.stringify({ directory, path, name, prefix, target, capability, sampleBase64, sourceSha256 }, null, 2) + '\n');
  return { directory, path, name, prefix, target: { provider: target.provider, spaceId: target.spaceId }, sourceSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await stageTask07StorageProbe({ root: fileURLToPath(new URL('../', import.meta.url)) }), null, 2));
}
