import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { walk, checkBoundaries } from './check-boundaries.mjs';
import { doctor } from './doctor.mjs';

// Offline inventory only: no cloud SDK, shell command, association, upload or DB API.
export async function createDeployPreview({ root, ticket }) {
  if (ticket !== undefined && !['task02', 'task03', 'task04', 'task05', 'task06', 'task07'].includes(ticket)) throw new Error('Unknown preview ticket');
  const target = JSON.parse(await readFile(join(root, 'ops/project-target.json'), 'utf8'));
  const readiness = await doctor({ root, ticket });
  if (readiness.blockers.includes('target-invalid')) throw new Error('Invalid project target');
  await checkBoundaries({ root });
  const all = [...await walk(join(root, target.cloudRoot)), ...await walk(join(root, 'src/uni_modules'))]
    .filter(path => !/[\\/]uni-config-center[\\/].*[\\/]config\.json$/.test(path));
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
    resources.push({ ...entry(common ? 'common-module' : object[1] === 'media-review-callback' ? 'cloud-function' : 'cloud-object', (common || object)[1], directory, hash(tree.join('\n'))), platformExtensionDeclarations: Object.keys(pkg.extensions || {}).sort() });
  }
  for (const path of all.filter(path => /\.(?:schema|index)\.json$/.test(path))) resources.push(entry(path.endsWith('.schema.json') ? 'schema' : 'index', basename(path), path, hash(await readFile(path))));
  return {
    ...(ticket ? { ticket } : {}),
    previewOnly: true, uploadAuthorized: false, blocked: true,
    target, region: 'unknown', runtime: 'unknown', existingResources: 'unknown',
    inventoryEvidence: 'Offline source preview only. Current resource names, versions and contents must be reconciled against coordinator read-only inventory before upload.',
    blockers: [...readiness.blockers, 'deployment-not-authorized', 'hbuilderx-ts-compilation-unverified', ...(ticket ? [`${ticket}-cloud-device-acceptance-pending`, 'bridge-version-reconciliation-required'] : [])],
    ...(ticket === 'task02' ? {
      sharedModuleImpact: ['account-co', 'uni-id-co'],
      dependencyRisks: [{ name: 'uni-open-bridge-common', localPluginVersion: '1.2.0', localCloudPackageVersion: '1.0.0', historicalCloudPluginVersion: '1.2.1', currentCloudVersion: 'unknown', action: 'blocked-no-upload', reason: 'Do not overwrite or downgrade the existing cloud dependency without reconciling actual source/version.' }],
      contentRuntimeRequirements: { provider: 'mp-weixin', version: 2, scene: 1, recentVerifiedUserOpenid: 'required; <=2 hours per official API', configuration: 'existing cloud-side uni-id/bridge secure configuration; never read by preview', cacheSchemas: ['opendb-open-data.schema.json'], cacheIndexes: ['_id built-in unique only; no additional index declared by locked source'], redis: 'optional upstream cache layer; target runtime verification pending', businessSchemaInitialization: 'only four named business collections and family_members ordinary familyId index; no full-plugin database initialization' },
    } : {}),
    ...(ticket === 'task03' ? {
      sharedModuleImpact: ['account-co', 'uni-id-co', 'family-co'],
      protectedDependencies: ['uni-id-common', 'uni-config-center', 'uni-open-bridge-common'],
      proposedChanges: resources.filter(item => ['family-co', 'home-family', 'home-kernel', 'home-contracts', 'family_invitations.schema.json', 'family_invitations.index.json', 'mutation_receipts.schema.json'].includes(item.name)),
      invitationConfiguration: { environmentVariables: ['FAMILY_INVITATION_KEY_VERSION', 'FAMILY_INVITATION_KEYS'], format: 'current version + JSON map of version to 64 lowercase hexadecimal characters (32 random bytes); cloud only', retainOldVersions: 'until all associated invitations expire', valuesIncluded: false, logCaptureVerified: false },
      preservationRequired: 'Read-only reconcile and preserve exact remote identity/configuration/bridge dependencies before any upload; no full-plugin initialization or collection reset.',
    } : {}),
    ...(ticket === 'task04' ? {
      sharedModuleImpact: ['account-co', 'uni-id-co', 'family-co'],
      protectedDependencies: ['uni-id-common', 'uni-config-center', 'uni-open-bridge-common'],
      proposedChanges: resources.filter(item => ['family-co', 'home-family', 'home-contracts', 'mutation_receipts.schema.json'].includes(item.name)),
      preservationRequired: 'Reconcile and preserve remote identity/configuration/bridge dependencies. Extend only the receipt schema; no collection reset, new collection, index, environment variable or plugin initialization.',
      compatibility: 'Deploy matching cloud and mini-program artifacts together in the isolated test space; MemberView now includes generation and strict older clients must be replaced.',
    } : {}),
    ...(ticket === 'task05' ? {
      sharedModuleImpact: ['account-co', 'uni-id-co', 'family-co', 'recipes-co'],
      protectedDependencies: ['uni-id-common', 'uni-config-center', 'uni-open-bridge-common'],
      proposedChanges: resources.filter(item => ['recipes-co', 'home-recipes', 'home-family', 'home-kernel', 'home-contracts', 'recipes.schema.json', 'recipes.index.json', 'mutation_receipts.schema.json'].includes(item.name)),
      preservationRequired: 'Reconcile remote identity/configuration/bridge dependencies before upload; no collection reset or full-plugin initialization. Family content checks retain scene 1; recipe checks use scene 3.',
      compatibility: 'Matching cloud and client contracts; all recipe writes require expected family and membership generation. Existing family interfaces remain unchanged.',
    } : {}),
    ...(ticket === 'task06' ? {
      sharedModuleImpact: ['account-co', 'uni-id-co', 'family-co', 'recipes-co'],
      protectedDependencies: ['uni-id-common', 'uni-config-center', 'uni-open-bridge-common'],
      proposedChanges: resources.filter(item => ['recipes-co', 'home-recipes', 'home-kernel', 'home-contracts', 'recipe_favorites.schema.json', 'mutation_receipts.schema.json'].includes(item.name)),
      preservationRequired: 'Preserve remote identity/configuration/bridge dependencies, existing recipes, indexes and receipts. Add only recipe_favorites with built-in _id uniqueness and extend receipt operation enum; no reset, plugin initialization or backfill.',
      compatibility: 'Deploy matching cloud/client artifacts in the isolated test space. Recipe.isFavorite is response-only; legacy recipes and immutable recipe receipt snapshots stay readable. Old cursors restart at first page.',
      queryBounds: { candidatesRead: 101, candidatesExamined: 100, recipesHydrated: 20, favoritesBatch: 100, index: 'existing family_created_id' },
    } : {}),
    ...(ticket === 'task07' ? {
      sharedModuleImpact: ['account-co', 'uni-id-co', 'family-co', 'recipes-co', 'media-co', 'media-review-callback'],
      proposedChanges: resources.filter(item => ['home-contracts', 'home-kernel', 'home-recipes', 'home-media', 'recipes-co', 'media-co', 'media-review-callback', 'media_files.schema.json', 'media_audit_traces.schema.json', 'mutation_receipts.schema.json'].includes(item.name)),
      media: { maxBytes: 1048576, maxImages: 20, mime: ['image/jpeg', 'image/png'], uploadLeaseSeconds: 300, targetUrlSeconds: 600, storagePrefix: 'task07-private', reviewDefault: 'disabled' },
      environmentVariables: ['MEDIA_REVIEW_ENABLED', 'MEDIA_REVIEW_CALLBACK_TOKEN', 'MEDIA_REVIEW_ENCODING_AES_KEY', 'MEDIA_REVIEW_WEIXIN_APP_ID'],
      preservationRequired: 'Preserve existing recipes, receipts, identity and bridge configuration; no reset or full-plugin initialization. Real ACL, callback and device acceptance remain separate from mock tests.',
    } : {}),
    compiledCloudArtifactSha256: null,
    resources: resources.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ticketIndex = process.argv.indexOf('--ticket'); const ticket = ticketIndex < 0 ? undefined : process.argv[ticketIndex + 1];
  if (ticketIndex >= 0 && !ticket) throw new Error('Missing preview ticket');
  const root = fileURLToPath(new URL('../', import.meta.url)); const preview = await createDeployPreview({ root, ticket });
  await writeFile(join(root, ticket ? `ops/${ticket}-deploy-preview.json` : 'ops/deploy-preview.json'), JSON.stringify(preview, null, 2) + '\n');
  console.log(`Offline preview: ${preview.resources.length} resources; UNKNOWN existing resources, upload BLOCKED.`);
}
