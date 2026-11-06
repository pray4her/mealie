import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip, hash, json, safePath, existing, noSymlinks } from './assemble-uni-id.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = 'https://ext.dcloud.net.cn/plugin?id=5460';
const digest = '63f5ce5f56f0d667fe10f26474b921f387bfb22ed6501ca069552c77299435b1';
export async function assembleContentCheck({ archivePath, lockPath, targetPath, check = false }) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (lock.source !== source || lock.version !== '2.0.2' || lock.module !== 'uni-sec-check' || lock.sha256 !== digest) throw new Error('Unknown content-check source/version/digest');
  const bytes = await readFile(archivePath); if (hash(bytes) !== digest) throw new Error('Archive digest mismatch');
  const archive = unzip(bytes, '');
  if (JSON.parse(archive.get('package.json')?.toString() || '{}').version !== '2.0.2' || archive.size !== 19) throw new Error('Archive module/version mismatch');
  const outputs = new Map();
  for (const [path, data] of archive) {
    safePath(path);
    if (!(path === 'package.json' || path === 'changelog.md' || path === 'readme.md' || path.startsWith('uniCloud/cloudfunctions/common/uni-sec-check/')) || /(?:config\.json|\.schema\.json)$/.test(path)) throw new Error('Unexpected content module path');
    outputs.set('src/uni_modules/uni-sec-check/' + path, data);
  }
  const root = resolve(targetPath); const manifestPath = resolve(root, 'vendor/content-check/generated.json');
  const previous = JSON.parse((await existing(manifestPath))?.toString() || '{"files":{}}');
  const files = Object.fromEntries([...outputs].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, hash(data)]));
  for (const path of Object.keys(previous.files)) if (!outputs.has(path)) throw new Error('Stale generated file requires reviewed removal: ' + path);
  // Reject unknown files as well as edits; only the exact official HBuilderX import can be adopted.
  async function inspect(dir) {
    await noSymlinks(root, dir);
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = join(dir, entry.name); await noSymlinks(root, path);
      if (entry.isDirectory()) await inspect(path);
      else if (!outputs.has(relative(root, path).split('\\').join('/'))) throw new Error('Refusing overwrite of unknown module file');
    }
  }
  await inspect(resolve(root, 'src/uni_modules/uni-sec-check'));
  for (const [path, data] of outputs) {
    const full = resolve(root, path); await noSymlinks(root, full); const current = await existing(full);
    if (current && !current.equals(data)) throw new Error('Refusing overwrite of non-generated/modified file: ' + path);
    if (check && !current) throw new Error('Generated output missing: ' + path);
  }
  const manifest = json({ sha256: digest, files });
  if (check) { if (!(await existing(manifestPath))?.equals(manifest)) throw new Error('Generated manifest differs'); }
  else {
    for (const [path, data] of outputs) { const full = resolve(root, path); await mkdir(dirname(full), { recursive: true }); await writeFile(full, data); }
    await mkdir(dirname(manifestPath), { recursive: true }); await writeFile(manifestPath, manifest);
  }
  return { outputs: Object.keys(files), sha256: digest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await assembleContentCheck({ archivePath: resolve(project, 'vendor/content-check/upstream.zip'), lockPath: resolve(project, 'vendor/content-check/lock.json'), targetPath: project, check: process.argv.includes('--check') });
  console.log('Content assembly verified');
}
