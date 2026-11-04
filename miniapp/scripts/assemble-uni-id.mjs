import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import ts from 'typescript';

const project = fileURLToPath(new URL('../', import.meta.url));
const revision = '993791b9eb298be8013f22daa9f2efee6c50cc23';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const safePath = path => {
  if (!path || path.includes('\\') || path.includes(':') || path.startsWith('/') || path.split('/').some(s => s === '..' || s === '.')) throw new Error('Archive path escape');
  return path;
};

// Minimal ZIP reader: central-directory sizes, regular files/directories only;
// no extraction to disk, no symlinks, duplicate/case-colliding paths, or bombs.
function unzip(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid ZIP archive');
  const commentLength = bytes.readUInt16LE(end + 20);
  if (bytes.subarray(end + 22, end + 22 + commentLength).toString('ascii') !== revision) throw new Error('Archive revision comment mismatch');
  const count = bytes.readUInt16LE(end + 10); let pos = bytes.readUInt32LE(end + 16); let total = 0;
  if (count > 10000) throw new Error('Archive too large');
  const files = new Map(); const seen = new Set();
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const flags = bytes.readUInt16LE(pos + 8), method = bytes.readUInt16LE(pos + 10);
    const size = bytes.readUInt32LE(pos + 24), compressed = bytes.readUInt32LE(pos + 20);
    const n = bytes.readUInt16LE(pos + 28), e = bytes.readUInt16LE(pos + 30), c = bytes.readUInt16LE(pos + 32);
    const path = safePath(bytes.subarray(pos + 46, pos + 46 + n).toString('utf8'));
    const mode = bytes.readUInt32LE(pos + 38) >>> 16; const offset = bytes.readUInt32LE(pos + 42);
    if (flags & 1 || (mode & 0xf000) === 0xa000 || size > 20_000_000 || (total += size) > 100_000_000) throw new Error('Unsafe ZIP archive');
    if (seen.has(path.toLowerCase())) throw new Error('Duplicate archive path'); seen.add(path.toLowerCase());
    if (!path.endsWith('/')) {
      if (bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP file');
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      const data = bytes.subarray(start, start + compressed);
      const value = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: size + 1 }) : null;
      if (!value || value.length !== size) throw new Error('Invalid ZIP size or compression'); files.set(path, value);
    }
    pos += 46 + n + e + c;
  }
  return files;
}
async function existing(path) { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function noSymlinks(root, path) {
  const rel = relative(root, path); if (rel.startsWith('..') || resolve(root, rel) !== path) throw new Error('Output path escape');
  let dir = root;
  for (const part of rel.split(sep)) { dir = resolve(dir, part); try { if ((await lstat(dir)).isSymbolicLink()) throw new Error('Output symlink escape'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

export async function assembleUniId({ archivePath, lockPath, targetPath, check = false }) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (lock.repository !== 'https://gitcode.com/dcloud/hello_uni-id-pages' || lock.revision !== revision || lock.root !== `hello_uni-id-pages-${revision}`) throw new Error('Unknown archive source/path');
  const bytes = await readFile(archivePath); const sha256 = hash(bytes);
  if (sha256 !== lock.sha256) throw new Error('Archive digest mismatch');
  const archive = unzip(bytes); const outputs = new Map(); const prefix = lock.root + '/';
  const entryPrefix = 'uni_modules/uni-id-pages/uniCloud/cloudfunctions/uni-id-co/';
  const objectRoot = 'uniCloud-alipay/cloudfunctions/uni-id-co/';
  for (const [name, bytes] of archive) {
    if (!name.startsWith(prefix)) throw new Error('Archive path outside source root');
    const path = name.slice(prefix.length); if (!path.startsWith('uni_modules/')) continue;
    if (/\/(?:db_init\.json|config\.json)$/.test(path) || path.includes('/pages/') || path.includes('/pages_init/') || path.includes('/static/')) continue;
    if (path.startsWith(entryPrefix)) {
      const rel = path.slice(entryPrefix.length);
      if (rel === 'package.json') continue;
      outputs.set(objectRoot + 'upstream/' + (rel === 'index.obj.js' ? 'entry.js' : rel), bytes); continue;
    }
    if (path.includes('/uniCloud/cloudfunctions/') && !path.includes('/uniCloud/cloudfunctions/common/')) continue;
    let data = bytes;
    if (path.endsWith('.schema.json')) {
      const parsed = ts.parseConfigFileTextToJson(path, bytes.toString());
      if (parsed.error) throw new Error('Invalid upstream Schema JSONC: ' + path);
      const schema = parsed.config; schema.permission = JSON.parse(await readFile(resolve(project, 'cloud-policies/clientdb-permissions.json'), 'utf8')); data = json(schema);
    }
    outputs.set('src/' + path, data);
  }
  const packagePath = prefix + 'uni_modules/uni-id-pages/package.json';
  if (JSON.parse(archive.get(packagePath)?.toString() || '{}').version !== lock.uniIdPagesVersion) throw new Error('Upstream version mismatch');
  const pkg = JSON.parse(archive.get(prefix + entryPrefix + 'package.json').toString());
  pkg.dependencies['home-kernel'] = 'file:../common/home-kernel'; pkg.dependencies['home-contracts'] = 'file:../common/home-contracts';
  for (const name of Object.keys(pkg.dependencies)) if (name.startsWith('uni-')) pkg.dependencies[name] = `file:../../../src/uni_modules/${name}/uniCloud/cloudfunctions/common/${name}`;
  outputs.set(objectRoot + 'package.json', json(pkg));
  outputs.set(objectRoot + 'policy.cjs', await readFile(resolve(project, 'cloud-policies/uni-id-entry.cjs')));
  outputs.set(objectRoot + 'index.obj.js', Buffer.from(`// Generated; change cloud-policies, never this file.\nconst upstream = require('./upstream/entry');\nconst { createEntry } = require('./policy.cjs');\nconst { createRequireIdentity, createUniIdPorts, createRequestLimiter, now } = require('home-kernel');\nconst limiter = createRequestLimiter({now, windowMs:60000, maxPerWindow:10, maxKeys:1024});\nmodule.exports = createEntry({ upstream, limiter, requireIdentity: (token, info, options) => createRequireIdentity({...createUniIdPorts(info),now})(token,info,options) });\n`));
  outputs.set('src/uni_modules/uni-id-pages/config.js', Buffer.from(`// Generated client policy; no upstream auth store is installed.\nexport default {loginTypes:['weixin'],isAdmin:false,setPasswordAfterLogin:false};\n`));
  const configRoot = 'src/uni_modules/uni-config-center/uniCloud/cloudfunctions/common/uni-config-center/uni-id/';
  outputs.set(configRoot + 'hooks/index.js', await readFile(resolve(project, 'cloud-policies/before-register.cjs')));
  outputs.set(configRoot + 'config.example.json', json({ dcloudAppid: '__UNI__5FDC0D7', tokenSecret: '', tokenExpiresIn: 7200, tokenExpiresThreshold: 1200, userRegisterDefaultRole: [], autoSetInviteCode: false, forceInviteCode: false, 'mp-weixin': { oauth: { weixin: { appid: 'wx68649810a6f363f3', appsecret: '' } } } }));
  const root = resolve(targetPath); const manifestPath = resolve(root, 'vendor/uni-id/generated.json');
  const previous = JSON.parse((await existing(manifestPath))?.toString() || '{"files":{}}');
  const files = Object.fromEntries([...outputs].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, hash(bytes)]));
  for (const path of Object.keys(previous.files)) if (!outputs.has(path)) throw new Error('Stale generated file requires reviewed removal: ' + path);
  // Complete preflight first; never partially overwrite when a later path conflicts.
  for (const [path, data] of outputs) {
    safePath(path); const full = resolve(root, path); await noSymlinks(root, full); const current = await existing(full);
    if (current && (!previous.files[path] || hash(current) !== previous.files[path])) throw new Error('Refusing overwrite of non-generated/modified file: ' + path);
    if (check && (!current || !current.equals(data))) throw new Error('Generated output differs: ' + path);
  }
  const manifest = json({ sha256, files });
  if (check) { if (!(await existing(manifestPath))?.equals(manifest)) throw new Error('Generated manifest differs'); }
  else {
    for (const [path, data] of outputs) { const full = resolve(root, path); await mkdir(dirname(full), { recursive: true }); await writeFile(full, data); }
    await mkdir(dirname(manifestPath), { recursive: true }); await writeFile(manifestPath, manifest);
  }
  return { outputs: Object.keys(files), sha256 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await assembleUniId({ archivePath: resolve(project, 'vendor/uni-id/upstream.zip'), lockPath: resolve(project, 'vendor/uni-id/lock.json'), targetPath: project, check: process.argv.includes('--check') });
  console.log('Identity assembly verified');
}
