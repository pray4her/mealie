import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { walk, checkBoundaries } from './check-boundaries.mjs';
import { doctor } from './doctor.mjs';

// Offline inventory only: no cloud SDK, shell command, association, upload or DB API.
export async function createDeployPreview({ root }) {
  const target = JSON.parse(await readFile(join(root, 'ops/project-target.json'), 'utf8'));
  const readiness = await doctor({ root });
  if (readiness.blockers.includes('target-invalid')) throw new Error('Invalid project target');
  await checkBoundaries({ root });
  const all = [...await walk(join(root, target.cloudRoot)), ...await walk(join(root, 'src/uni_modules'))]
    .filter(path => !/[\\/]uni-config-center[\\/]uni-id[\\/]config\.json$/.test(path));
  const resources = [];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const entry = (kind, name, path, sha256) => ({ kind, name, path: relative(root, path).split('\\').join('/'), sha256, hashKind: kind === 'schema' || kind === 'index' ? 'file-sha256' : 'source-tree-sha256', existing: 'unknown', action: 'blocked-no-upload' });
  for (const path of all.filter(path => path.endsWith('package.json'))) {
    const normalized = path.split('\\').join('/');
    const common = normalized.match(/\/cloudfunctions\/common\/([^/]+)\/package.json$/);
    const object = normalized.match(/\/uniCloud-alipay\/cloudfunctions\/([^/]+)\/package.json$/);
    if (!common && !object) continue;
    const directory = dirname(path); const files = all.filter(file => file.startsWith(directory + (process.platform === 'win32' ? '\\' : '/'))).sort();
    const tree = [];
    for (const file of files) tree.push(relative(directory, file).split('\\').join('/') + '\0' + hash(await readFile(file)));
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    resources.push({ ...entry(common ? 'common-module' : 'cloud-object', (common || object)[1], directory, hash(tree.join('\n'))), platformExtensionDeclarations: Object.keys(pkg.extensions || {}).sort() });
  }
  for (const path of all.filter(path => /\.(?:schema|index)\.json$/.test(path))) resources.push(entry(path.endsWith('.schema.json') ? 'schema' : 'index', basename(path), path, hash(await readFile(path))));
  return {
    previewOnly: true, uploadAuthorized: false, blocked: true,
    target, region: 'unknown', runtime: 'unknown', existingResources: 'unknown',
    inventoryEvidence: 'Coordinator read-only resource-list attempts returned BUSINESS_ERROR; no successful inventory.',
    blockers: [...readiness.blockers, 'deployment-not-authorized', 'hbuilderx-ts-compilation-unverified'],
    compiledCloudArtifactSha256: null,
    resources: resources.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url)); const preview = await createDeployPreview({ root });
  await writeFile(join(root, 'ops/deploy-preview.json'), JSON.stringify(preview, null, 2) + '\n');
  console.log(`Offline preview: ${preview.resources.length} resources; UNKNOWN existing resources, upload BLOCKED.`);
}
