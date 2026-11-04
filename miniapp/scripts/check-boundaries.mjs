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
  const allowed = ['uni-id-co/index.obj.js', 'account-co/index.obj.ts'].map(path => resolve(root, 'uniCloud-alipay/cloudfunctions', path));
  if (objectEntries.length !== 2 || objectEntries.some(path => !allowed.includes(path))) throw new Error('Unexpected discoverable public cloud object');
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
        if (/(?:home-kernel|uniCloud-|cloudfunctions|vendor\/|tests\/|node:|uni-id-common|uni-config-center)/i.test(specifier) || (specifier.includes('home-contracts') && !typeOnly)) throw new Error('Client runtime cloud import denied: ' + path);
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
  for (const path of cloud.filter(p => /[\\/]package\.json$/.test(p))) {
    const pkg = JSON.parse(await readFile(path, 'utf8'));
    for (const dependency of Object.values(pkg.dependencies || {})) {
      if (typeof dependency !== 'string' || !dependency.startsWith('file:')) continue;
      const target = resolve(path, '..', dependency.slice(5));
      if (!target.startsWith(resolve(root) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Deployment dependency path escape: ' + path);
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
    if (/[\\/]account-co[\\/]index\.obj\.ts$/.test(path)) {
      const exports = ast.statements.filter(node => ts.isExportDeclaration(node) || ts.isExportAssignment(node) || (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)));
      if (exports.length !== 1 || !ts.isFunctionDeclaration(exports[0]) || exports[0].name?.text !== 'session' || ts.getModifiers(exports[0])?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) throw new Error('Unexpected account-co public method export');
    }
  }
  if (artifacts) {
    const files = await walk(join(root, 'dist/build/mp-weixin'));
    if (!files.length) throw new Error('Artifact missing');
    for (const path of files) {
      if (/(?:[\\/](?:vendor|tests|cloudfunctions)[\\/]|uniCloud-|\.zip$|\.tar\.gz$)/i.test(path.slice(root.length))) throw new Error('Artifact contains forbidden source');
      if (/\.(?:js|json|map|wxml)$/.test(path) && /(?:vendor\/uni-id|tests\/support|home-kernel|cloudfunctions\/common|tokenSecret["']?\s*[:=]|appsecret["']?\s*[:=])/i.test(await readFile(path, 'utf8'))) throw new Error('Artifact source/secret boundary violation');
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await checkBoundaries({ root: fileURLToPath(new URL('../', import.meta.url)), artifacts: process.argv.includes('--artifacts') }); console.log('Boundaries verified'); }
