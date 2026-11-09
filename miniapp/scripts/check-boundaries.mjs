import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
export async function walk(root) {
  let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Boundary symlink denied');
    const path = join(root, entry.name); result.push(...(entry.isDirectory() ? await walk(path) : [path]));
  }
  return result;
}
export async function checkBoundaries({ root, artifacts = false }) {
  const roots = (await readdir(root)).filter(name => /^uniCloud(?:-|$)/.test(name));
  if (roots.length !== 1 || roots[0] !== 'uniCloud-alipay') throw new Error('Expected exactly one verified provider cloud root');
  const client = await walk(join(root, 'src')); const cloud = await walk(join(root, 'uniCloud-alipay'));
  const discovered = [...client, ...cloud].filter(path => /[\\/]uni-id-co[\\/]index\.obj\.[jt]s$/.test(path));
  if (discovered.length !== 1 || !discovered[0].includes('uniCloud-alipay')) throw new Error('Expected unique uni-id-co; duplicate or missing object');
  const objectEntries = [...client, ...cloud].filter(path => /[\\/]index\.obj\.[jt]s$/.test(path));
  const allowed = ['uni-id-co/index.obj.js', 'account-co/index.obj.ts', 'family-co/index.obj.ts'].map(path => resolve(root, 'uniCloud-alipay/cloudfunctions', path));
  if (objectEntries.length !== 3 || objectEntries.some(path => !allowed.includes(path))) throw new Error('Unexpected discoverable public cloud object');
  for (const path of [...client, ...cloud].filter(path => path.endsWith('.schema.json'))) {
    const permission = JSON.parse(await readFile(path, 'utf8')).permission;
    if (!permission || ['read', 'create', 'update', 'delete'].some(key => permission[key] !== false)) throw new Error('ClientDB permission open: ' + path);
  }
  for (const path of client) {
    const source = await readFile(path, 'utf8');
    if (path.endsWith('.schema.json')) {
      const permission = JSON.parse(source).permission;
      if (!permission || ['read', 'create', 'update', 'delete'].some(key => permission[key] !== false)) throw new Error('Identity clientDB permission open: ' + path);
    }
    if (/\.[jt]s$|\.vue$/.test(path) && !path.includes('uni_modules')) {
      const code = path.endsWith('.vue') ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n') : source;
      const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
      const check = (specifier, typeOnly) => {
        if (typeof specifier !== 'string') throw new Error('Client dynamic runtime import denied: ' + path);
        if (/(?:home-kernel|home-family|uni-sec-check|uni-open-bridge|uniCloud-|cloudfunctions|vendor\/|tests\/|node:|uni-id-common|uni-config-center)/i.test(specifier) || (specifier.includes('home-contracts') && !typeOnly)) throw new Error('Client runtime cloud import denied: ' + path);
      };
      const visit = node => {
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          const typeOnly = clause?.isTypeOnly || (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(e => e.isTypeOnly) && !clause.name);
          check(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null, typeOnly);
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier) check(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null, node.isTypeOnly);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) check(node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null, false);
        ts.forEachChild(node, visit);
      }; visit(ast);
    }
  }
  for (const path of [...cloud, ...client.filter(p => /[\\/]cloudfunctions[\\/]common[\\/]/.test(p))].filter(p => /[\\/]package\.json$/.test(p))) {
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    for (const dependency of Object.values(pkg.dependencies || {})) {
      if (typeof dependency !== 'string' || !dependency.startsWith('file:')) continue;
      const target = resolve(path, '..', dependency.slice(5));
      if (!target.startsWith(resolve(root) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Deployment dependency path escape: ' + path);
      try { JSON.parse(await readFile(join(target, 'package.json'), 'utf8')); }
      catch { throw new Error('Deployment dependency package missing/invalid: ' + path); }
    }
  }
  const packages = cloud.filter(p => /[\\/]package\.json$/.test(p)).map(dirname).sort((a, b) => b.length - a.length);
  for (const path of cloud.filter(p => /\.(?:[cm]?js|ts)$/.test(p) && !p.endsWith('.d.ts'))) {
    const packageRoot = packages.find(dir => path.startsWith(dir + sep)) ?? (path.endsWith('index.obj.ts') ? dirname(path) : null);
    if (!packageRoot) continue;
    const source = await readFile(path, 'utf8'); const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const inspect = specifier => {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
      const target = resolve(dirname(path), specifier);
      if (target !== packageRoot && !target.startsWith(packageRoot + sep)) throw new Error('Deployment runtime dependency escape: ' + path);
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspect(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) inspect(node.arguments[0].text);
        else if (!/[\\/]upstream[\\/]/.test(path)) throw new Error('Authored deployment dynamic dependency denied: ' + path);
      }
      ts.forEachChild(node, visit);
    }; visit(ast);
    if (/[\\/](?:account-co|family-co)[\\/]index\.obj\.ts$/.test(path)) {
      const exports = ast.statements.filter(node => ts.isExportDeclaration(node) || ts.isExportAssignment(node) || (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)));
      const expected = path.includes('family-co') ? ['create', 'current', 'invite', 'revokeInvite', 'join', 'members', 'invitations', 'leave', 'removeMember', 'transferOwner'] : ['session'];
      if (exports.length !== expected.length || exports.some(node => !ts.isFunctionDeclaration(node) || !expected.includes(node.name?.text) || ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword))
        || new Set(exports.map(node => node.name?.text)).size !== expected.length) throw new Error('Unexpected public method export: ' + path);
    }
  }
  if (artifacts) {
    const files = await walk(join(root, 'dist/build/mp-weixin'));
    if (!files.length) throw new Error('Artifact missing');
    let manifest;
    try { manifest = JSON.parse(await readFile(join(root, 'dist/build/mp-weixin/app.json'), 'utf8')); }
    catch { throw new Error('Artifact route manifest missing/invalid'); }
    const pages = ['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members'];
    if (!Array.isArray(manifest.pages) || manifest.pages.length !== pages.length || manifest.pages.some((page, index) => page !== pages[index])
      || manifest.subPackages || manifest.subpackages || manifest.tabBar) throw new Error('Artifact routes must be exactly the six implemented account/family pages');
    for (const path of files) {
      if (/(?:[\\/](?:vendor|tests|cloudfunctions)[\\/]|uniCloud-|\.zip$|\.tar\.gz$)/i.test(path.slice(root.length))) throw new Error('Artifact contains forbidden source');
      if (/\.(?:js|json|map|wxml)$/.test(path) && /(?:vendor\/|tests\/support|home-kernel|home-family|uni-sec-check|uni-open-bridge|cloudfunctions\/common|FAMILY_INVITATION_KEYS|FAMILY_INVITATION_KEY_VERSION|tokenSecret["']?\s*[:=]|appsecret["']?\s*[:=])/i.test(await readFile(path, 'utf8'))) throw new Error('Artifact source/secret boundary violation');
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await checkBoundaries({ root: fileURLToPath(new URL('../', import.meta.url)), artifacts: process.argv.includes('--artifacts') }); console.log('Boundaries verified'); }
