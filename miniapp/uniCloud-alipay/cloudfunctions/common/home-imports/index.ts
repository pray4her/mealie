import type { FamilyContext, ImportsApi, ImportSubmit } from 'home-contracts';
import { AppError, DatabaseFault, safeError, consumeRequestLimit } from 'home-kernel';
import type { DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { hash, jobId, jobView, terminal } from './model';
import type { ImportConfig, Job } from './model';
import { reserve, settleCheckpoint } from './quota';
import { normalizePublicUrl } from './urls';
export { runImportWorker } from './worker';
export { createOpenRouterProvider } from './provider';
export { createImportReads } from './reads';
export { importConfig } from './model';
export { createJinaReader } from './reader';
export { dnsResolver, normalizePublicUrl, validatePublicSource } from './urls';
export type { ImportConfig, Job, Usage } from './model';
export type { Provider } from './provider';
export type { ImportReads, ImportReadPlatform } from './reads';
export type { ReaderRequest, UrlReaderPort } from './reader';
export type { Resolver, ValidatedSource } from './urls';
export const validId = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new AppError('INVALID_INPUT'); return value; };
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new AppError('INVALID_INPUT'); return value as Record<string, unknown>;
}
export function mutationScope(value: Record<string, unknown>, ctx: FamilyContext) {
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) || typeof value.familyId !== 'string' || typeof value.generation !== 'string') throw new AppError('INVALID_INPUT');
  if (value.familyId !== ctx.familyId || value.generation !== ctx.generation) throw new AppError('CONFLICT');
}
export function textSource(source: unknown): string {
  if (source && typeof source === 'object' && 'kind' in source && ['image', 'url'].includes(String(source.kind))) throw new AppError('UNAVAILABLE');
  const row = exact(source, ['kind', 'text']);
  if (row.kind !== 'text' || typeof row.text !== 'string' || !row.text.trim() || Buffer.byteLength(row.text, 'utf8') > 16384
    || /\p{Cc}/u.test(row.text.replace(/[\n\r\t]/g, '')) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(row.text)) throw new AppError('INVALID_INPUT'); return row.text;
}
export function urlSource(source: unknown): string {
  const row = exact(source, ['kind', 'url']);
  if (row.kind !== 'url') throw new AppError('INVALID_INPUT');
  return normalizePublicUrl(row.url);
}
export function createImportsService(deps: { database: DatabasePort; now(): number; config(): ImportConfig; revalidateIdentity(): Promise<void> }, ctx: FamilyContext): ImportsApi {
  async function confirm(tx: TransactionPort) {
    const member = await readFamily(tx, ctx.uid);
    if (!member) throw new AppError('FAMILY_REQUIRED');
    if (member.familyId !== ctx.familyId || member.generation !== ctx.generation) throw new AppError('CONFLICT');
    return member;
  }
  async function own(tx: TransactionPort, id: string) {
    await confirm(tx); const row = await tx.get<Job>('import_jobs', id);
    if (!row || row.uid !== ctx.uid || row.familyId !== ctx.familyId || row.generation !== ctx.generation) throw new AppError('NOT_FOUND'); return row;
  }
  async function call<T>(action: () => Promise<T>) {
    try {
      await deps.database.transaction(confirm);
      await consumeRequestLimit(deps.database, { subject: 'uid:' + ctx.uid, operation: 'imports-v1', now: deps.now(), max: 60 });
      const result = await action(); await deps.revalidateIdentity(); await deps.database.transaction(confirm); return result;
    } catch (error) { throw safeError(error); }
  }
  async function recover<T>(action: () => Promise<T>, read: () => Promise<T>) {
    try { return await action(); } catch (error) { if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error; await deps.revalidateIdentity(); return read(); }
  }
  return {
    submit(raw) { return call(async () => {
      const input = exact(raw, ['requestId', 'familyId', 'generation', 'source']); mutationScope(input, ctx);
      const isUrl = !!input.source && typeof input.source === 'object' && (input.source as Record<string, unknown>).kind === 'url';
      const sourceText = isUrl ? null : textSource(input.source);
      const sourceUrl = isUrl ? urlSource(input.source) : null;
      const id = jobId(ctx.uid, ctx.familyId, ctx.generation, (input as ImportSubmit).requestId); const payloadHash = isUrl ? hash(['url', sourceUrl]) : hash(['text', sourceText]);
      async function previous(tx: TransactionPort) {
        await confirm(tx); const row = await tx.get<Job>('import_jobs', id);
        if (row && (row.uid !== ctx.uid || row.familyId !== ctx.familyId || row.generation !== ctx.generation || row.payloadHash !== payloadHash)) throw new AppError('CONFLICT'); return row;
      }
      return recover(() => deps.database.transaction(async tx => {
        const replay = await previous(tx); if (replay) return jobView(replay);
        const config = deps.config(); if (!config.enabled || (isUrl && !config.urlEnabled)) throw new AppError('UNAVAILABLE');
        const current = await confirm(tx); await guardMutation(tx, current); const timestamp = deps.now();
        const taskBuckets = await reserve(tx, ctx, timestamp, config, true);
        const job: Job = { _id: id, uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation, requestId: input.requestId as string, payloadHash,
          state: 'queued', attempts: 0, recipeId: null, error: null, createdAt: timestamp, updatedAt: timestamp, sourceText, sourceKind: isUrl ? 'url' : 'text', sourceUrl, sourceWarnings: null, purgeAt: timestamp + 7 * 86400000,
          nextRunAt: timestamp, lease: null, leaseUntil: 0, candidate: null, usageId: null, taskBuckets, visitedAt: timestamp };
        await tx.insert('import_jobs', id, job); return jobView(job);
      }), () => deps.database.transaction(async tx => { const row = await previous(tx); if (!row) throw new AppError('UNAVAILABLE'); return jobView(row); }));
    }); },
    get(id) { return call(() => deps.database.transaction(async tx => {
      const job = await own(tx, validId(id));
      if (!terminal(job.state)) await tx.replace('import_jobs', job._id, { ...job, visitedAt: deps.now() });
      return jobView(job);
    })); },
    cancel(raw) { return call(async () => {
      const input = exact(raw, ['requestId', 'familyId', 'generation', 'id']); mutationScope(input, ctx); const id = validId(input.id);
      const read = () => deps.database.transaction(async tx => jobView(await own(tx, id)));
      return recover(() => deps.database.transaction(async tx => {
        const job = await own(tx, id); if (terminal(job.state)) return jobView(job);
        await guardMutation(tx, await confirm(tx));
        await settleCheckpoint(tx, job);
        const result: Job = { ...job, state: 'cancelled', sourceText: null, sourceUrl: null, sourceWarnings: null, candidate: null, purgeAt: 0, updatedAt: deps.now(), lease: null, leaseUntil: 0 };
        await tx.replace('import_jobs', id, result); return jobView(result);
      }), read);
    }); },
  };
}
