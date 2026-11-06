import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './check-boundaries.mjs';
export async function checkSecrets({ root, artifacts = false }) {
  const paths = [...await walk(join(root, 'src')), ...await walk(join(root, 'uniCloud-alipay')),
    ...(artifacts ? await walk(join(root, 'dist/build/mp-weixin')) : [])];
  for (const path of paths) {
    // Local real config is intentionally not read; it must never enter an artifact.
    if (/[\\/]uni-config-center[\\/]uni-id[\\/]config\.json$/.test(path)) continue;
    if (!/\.(?:[cm]?[jt]s|vue|json|wxml|wxss|map|env)$/.test(path)) continue;
    // The locked official module has this public error enum, not a credential.
    // Exclude only that exact identifier/value pair; secret-valued suffix keys still fail.
    const source = (await readFile(path, 'utf8')).replace(/\bINVALID_APPSECRET\s*:\s*(['"])invalid-appsecret\1/g, '');
    if (/(?:appsecret|tokenSecret|passwordSecret|privateKey|apiKey)["']?\s*[:=]\s*["'][^"'\s]{12,}["']/i.test(source)
      || /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source)
      || /VITE_\w*(?:SECRET|PRIVATE_KEY)\s*=\s*\S+/i.test(source)) throw new Error('Secret detected in ' + path); // No matched value or line contents.
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await checkSecrets({ root: fileURLToPath(new URL('../', import.meta.url)), artifacts: true }); console.log('Source and artifact secret scan verified'); }
