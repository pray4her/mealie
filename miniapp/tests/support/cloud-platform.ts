import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const realRequire = createRequire(import.meta.url);
export function cloudFixture(entryName: 'family-co' | 'recipes-co' | 'media-co' = 'family-co', commitAcknowledgement: 'object' | 'void' = 'object') {
  const files = new Map<string, Buffer>();
  const rows = new Map<string, Record<string, unknown>>();
  const checks: { token: string; autoRefresh: boolean }[] = [];
  const contentCalls: unknown[] = []; const contexts: unknown[] = []; const reads: string[] = [];
  let active = true; let contentResult: unknown = { errCode: 0, errMsg: '', result: { suggest: 'pass', label: '正常' } };
  let afterContent = () => {}; let transactions = 0; let commits = 0; let rollbacks = 0; let sdkImports = 0;
  const key = (collection: string, id: string) => collection + '/' + id;
  const database = {
    collection(collection: string) { return { doc(id: string) { return { field() { return { async get() {
      reads.push(id);
      return { data: collection === 'uni-id-users' && id === 'alice' ? [{ status: active ? 0 : 1, token: ['verified-token'], wx_openid: { mp___UNI__5FDC0D7: 'server-openid' } }] : [] };
    } }; } }; } }; },
    async startTransaction() {
      transactions++; const staged = new Map(rows);
      return {
        collection(collection: string) { return {
          doc(id: string) { return { async get() { return { data: staged.get(key(collection, id)) ?? null }; },
            async update(value: object) { const k = key(collection, id); if (!staged.has(k)) return { updated: 0 }; staged.set(k, { ...staged.get(k), ...value }); return { updated: 1 }; },
            async remove() { return { deleted: staged.delete(key(collection, id)) ? 1 : 0 }; } }; },
          async add(value: Record<string, unknown>) { const id = String(value._id); if (staged.has(key(collection, id))) throw new Error('fixture duplicate'); staged.set(key(collection, id), value); return { id }; },
        }; },
        async commit() { commits++; rows.clear(); for (const [key, value] of staged) rows.set(key, value); if (commitAcknowledgement === 'object') return {}; },
        async rollback() { rollbacks++; return {}; },
      };
    },
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path)!.exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { module, exports: module.exports, Buffer, URL, setTimeout, clearTimeout, process: { env: { FAMILY_INVITATION_KEY_VERSION: 'test', FAMILY_INVITATION_KEYS: JSON.stringify({ test: '01'.repeat(32) }) } }, uniCloud: { database: () => database, async uploadFile(input: { cloudPath: string; fileContent: Buffer }) { const fileID = 'cloud://mock/' + input.cloudPath; files.set(fileID, input.fileContent); return { fileID }; }, async downloadFile(input: { fileID: string }) { return { fileContent: files.get(input.fileID) }; }, async getTempFileURL(input: { fileList: string[] }) { return { fileList: input.fileList.map(fileID => ({ fileID, tempFileURL: 'https://mock.invalid/file?expire_at=' + Math.floor(Date.now() / 1000 + 600) })) }; } }, require: (name: string) => {
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
  return { entry, context, checks, contentCalls, contexts, reads, rows, get transactions() { return transactions; }, get commits() { return commits; }, get rollbacks() { return rollbacks; }, get sdkImports() { return sdkImports; }, revoke() { active = false; }, restore() { active = true; }, setContent(value: unknown) { contentResult = value; }, afterContent(fn: () => void) { afterContent = fn; } };
}
