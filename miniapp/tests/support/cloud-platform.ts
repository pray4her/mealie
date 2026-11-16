import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const realRequire = createRequire(import.meta.url);
type Row = Record<string, unknown>;
type CommitEvent = { reads: readonly string[]; writes: readonly string[] };
type CommitHook = (event: CommitEvent) => void | Promise<void>;
export interface CloudFixtureOptions { optimistic?: boolean; queryResult?: unknown }
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === 'and' || field === 'or') {
      const clauses = expected as Row[];
      return field === 'and' ? clauses.every(clause => matches(row, clause)) : clauses.some(clause => matches(row, clause));
    }
    if (!expected || typeof expected !== 'object') return row[field] === expected;
    return Object.entries(expected).every(([operator, value]) => {
      const actual = row[field] as string | number; const bound = value as string | number;
      if (operator === 'gt') return actual > bound;
      if (operator === 'gte') return actual >= bound;
      if (operator === 'lte') return actual <= bound;
      throw new Error('Unsupported fixture query operator');
    });
  });
}
export function cloudFixture(entryName: 'family-co' | 'recipes-co' | 'media-co' | 'imports-co' | 'planning-co' | 'shopping-co' = 'family-co', commitAcknowledgement: 'object' | 'void' = 'object', options: CloudFixtureOptions = {}) {
  const files = new Map<string, Buffer>();
  const rows = new Map<string, Record<string, unknown>>();
  const checks: { token: string; autoRefresh: boolean }[] = [];
  const contentCalls: unknown[] = []; const contexts: unknown[] = []; const reads: string[] = [];
  let active = true; let contentResult: unknown = { errCode: 0, errMsg: '', result: { suggest: 'pass', label: '正常' } };
  let afterContent = () => {}; let transactions = 0; let commits = 0; let rollbacks = 0; let sdkImports = 0;
  const key = (collection: string, id: string) => collection + '/' + id;
  const projections: { collection: string; id: string; fields: Row }[] = [];
  let beforeCommit: CommitHook = () => {}; let afterCommit: CommitHook = () => {}; let afterQuery = () => {};
  const database = {
    command: { set: (value: unknown) => ({ __set: value }),
      gt: (value: unknown) => ({ gt: value }), gte: (value: unknown) => ({ gte: value }), lte: (value: unknown) => ({ lte: value }),
      and: (value: Row[]) => ({ and: value }), or: (value: Row[]) => ({ or: value }) },
    collection(collection: string) {
      let filter: Row = {}; let fields: Record<string, boolean> | undefined; let count = Infinity;
      const order: [string, 'asc' | 'desc'][] = [];
      const project = (row: Row) => fields ? Object.fromEntries(Object.entries(row).filter(([field]) => fields![field])) : row;
      return {
        where(value: Row) { filter = value; return this; }, field(value: Record<string, boolean>) { fields = value; return this; },
        orderBy(field: string, direction: 'asc' | 'desc') { order.push([field, direction]); return this; }, limit(value: number) { count = value; return this; },
        async get() {
          const data = [...rows.entries()].filter(([k, row]) => k.startsWith(collection + '/') && matches(row, filter)).map(([, row]) => row);
          data.sort((a, b) => { for (const [field, direction] of order) { const x = a[field] as string | number; const y = b[field] as string | number; if (x !== y) return (x < y ? -1 : 1) * (direction === 'asc' ? 1 : -1); } return 0; });
          const result = { data: data.slice(0, count).map(project) }; afterQuery();
          return Object.hasOwn(options, 'queryResult') ? options.queryResult : result;
        },
        doc(id: string) { return {
          field(value: Record<string, boolean>) { fields = value; projections.push({ collection, id, fields: value }); return this; },
          async get() {
            reads.push(id);
            const row = collection === 'uni-id-users' && id === 'alice'
              ? { status: active ? 0 : 1, token: ['verified-token'], wx_openid: { mp___UNI__5FDC0D7: 'server-openid' } } : rows.get(key(collection, id));
            return { data: row ? [project(row)] : [] };
          },
        }; },
      };
    },
    async startTransaction() {
      transactions++; const snapshot = new Map(rows); const staged = new Map(snapshot);
      const readKeys = new Set<string>(); const writeKeys = new Set<string>();
      return {
        collection(collection: string) { return {
          doc(id: string) { const k = key(collection, id); return {
            async get() { readKeys.add(k); return { data: staged.get(k) ?? null }; },
            async update(value: object) { readKeys.add(k); if (!staged.has(k)) return { updated: 0 }; const merged = { ...staged.get(k) }; for (const [field, item] of Object.entries(value)) merged[field] = item && typeof item === 'object' && '__set' in item ? (item as { __set: unknown }).__set : item; staged.set(k, merged); writeKeys.add(k); return { updated: 1 }; },
            async remove() { readKeys.add(k); writeKeys.add(k); return { deleted: staged.delete(k) ? 1 : 0 }; },
          }; },
          async add(value: Record<string, unknown>) { const id = String(value._id); const k = key(collection, id); readKeys.add(k); if (staged.has(k)) throw new Error('fixture duplicate'); staged.set(k, value); writeKeys.add(k); return { id }; },
        }; },
        async commit() {
          commits++; const event = { reads: [...readKeys], writes: [...writeKeys] }; await beforeCommit(event);
          // Fixture-only optimistic validation, NOT a provider conflict code or cloud acceptance.
          if (options.optimistic && [...readKeys].some(k => rows.get(k) !== snapshot.get(k))) throw new Error('Fixture optimistic collision');
          // Apply only this transaction's writes: read-only commits must never restore stale rows.
          for (const k of writeKeys) { const value = staged.get(k); if (value) rows.set(k, value); else rows.delete(k); }
          await afterCommit(event); if (commitAcknowledgement === 'object') return {};
        },
        async rollback() { rollbacks++; return {}; },
      };
    },
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path)!.exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { module, exports: module.exports, Buffer, URL, setTimeout, clearTimeout, process: { env: { IMPORTS_ENABLED: 'true', IMPORTS_URL_ENABLED: 'true', FAMILY_INVITATION_KEY_VERSION: 'test', FAMILY_INVITATION_KEYS: JSON.stringify({ test: '01'.repeat(32) }) } }, uniCloud: { database: () => database, async uploadFile(input: { cloudPath: string; fileContent: Buffer }) { const fileID = 'cloud://mock/' + input.cloudPath; files.set(fileID, input.fileContent); return { fileID }; }, async downloadFile(input: { fileID: string }) { return { fileContent: files.get(input.fileID) }; }, async getTempFileURL(input: { fileList: string[] }) { return { fileList: input.fileList.map(fileID => ({ fileID, tempFileURL: 'https://mock.invalid/file?expire_at=' + Math.floor(Date.now() / 1000 + 600) })) }; } }, require: (name: string) => {
      if (name === 'uni-id-common') { sdkImports++; return { createInstance: () => ({ async checkToken(token: string, options: { autoRefresh: boolean }) {
        checks.push({ token, ...options }); if (token !== 'verified-token') return { errCode: 'bad' };
        return { errCode: 0, uid: 'alice', iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 3600, ...(options.autoRefresh ? { token: 'renewed-token', tokenExpired: Date.now() + 3600000 } : {}) };
      } }) }; }
      if (name === 'uni-sec-check') { sdkImports++; return class { constructor(options: unknown) { contexts.push(options); } async textSecCheck(input: unknown) { contentCalls.push(input); afterContent(); return contentResult; } }; }
      if (name.startsWith('node:')) return realRequire(name);
      if (name.startsWith('home-')) return load(resolve('uniCloud-alipay/cloudfunctions/common', name, 'index.ts'));
      if (name.startsWith('.')) return load(resolve(dirname(path), name + '.ts'));
      throw new Error('Unexpected SDK dependency');
    } });
    return module.exports;
  }
  const entry = load(resolve('uniCloud-alipay/cloudfunctions', entryName, 'index.obj.ts')) as {
    add: (this: object, ...args: unknown[]) => Promise<unknown>;
    remove: (this: object, ...args: unknown[]) => Promise<unknown>;
    submit: (this: object, ...args: unknown[]) => Promise<unknown>;
    cancel: (this: object, ...args: unknown[]) => Promise<unknown>;
    createList: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    renameList: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    removeList: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    listLists: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    getList: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    addItem: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    updateItem: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    removeItem: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    setChecked: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    listItems: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    getItem: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    requestUpload: (this: object, ...args: unknown[]) => Promise<unknown>;
    upload: (this: object, ...args: unknown[]) => Promise<unknown>;
    complete: (this: object, ...args: unknown[]) => Promise<unknown>;
    status: (this: object, ...args: unknown[]) => Promise<unknown>;
    read: (this: object, ...args: unknown[]) => Promise<unknown>;
    bindImages: (this: object, ...args: unknown[]) => Promise<unknown>;
    get: (this: object, ...args: unknown[]) => Promise<unknown>;
    list: (this: object, ...args: unknown[]) => Promise<unknown>;
    update: (this: object, ...args: unknown[]) => Promise<unknown>;
    favorite: (this: object, ...args: unknown[]) => Promise<unknown>;
    current: (this: object, ...args: unknown[]) => Promise<unknown>;
    create: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    invite: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    revokeInvite: (this: object, input: unknown) => Promise<unknown>;
    join: (this: object, input: unknown) => Promise<unknown>;
    members: (this: object, ...args: unknown[]) => Promise<unknown>;
    invitations: (this: object, input: unknown) => Promise<unknown>;
    leave: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    removeMember: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
    transferOwner: (this: object, input: unknown, ...extra: unknown[]) => Promise<unknown>;
  };
  const context = { getUniIdToken: () => 'verified-token', getClientInfo: () => ({ appId: '__UNI__5FDC0D7', uniPlatform: 'mp-weixin' }), getUniCloudRequestId: () => 'platform-request' };
  return { entry, context, checks, contentCalls, contexts, reads, rows, projections,
    beforeCommit(fn: CommitHook) { beforeCommit = fn; }, afterCommit(fn: CommitHook) { afterCommit = fn; }, afterQuery(fn: () => void) { afterQuery = fn; },
    get transactions() { return transactions; }, get commits() { return commits; }, get rollbacks() { return rollbacks; }, get sdkImports() { return sdkImports; }, revoke() { active = false; }, restore() { active = true; }, setContent(value: unknown) { contentResult = value; }, afterContent(fn: () => void) { afterContent = fn; } };
}
