import type { FamilyContext, ImportError, RecipeInput } from 'home-contracts';
import { AppError, DatabaseFault } from 'home-kernel';
import type { ContentPort, DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { auditText, insertRecipe, recipeInput } from 'home-recipes';
import type { ImportConfig, Job, Usage } from './model';
import { hash, terminal } from './model';
import { reserve, settle, settleCheckpoint } from './quota';
import type { UsageResult } from './quota';
import { ImportFailure, unknownUsage } from './provider';
import type { Provider } from './provider';
import type { ImportReads } from './reads';
import type { UrlReaderPort } from './reader';
import type { Resolver, ValidatedSource } from './urls';
import { validatePublicSource } from './urls';
import { requireImportMedia, releaseImportMedia, readImportImage, cleanupImportMedia } from 'home-media';
import type { StoragePort } from 'home-media';
import type { ProviderInput } from './provider';

export interface WorkerDeps { database: DatabasePort; reads: ImportReads; now(): number; newId(): string; config(): ImportConfig; provider: Provider;
  reader?: UrlReaderPort; resolve?: Resolver; storage?: StoragePort;
  content(job: Job): ContentPort; activeUser(uid: string): Promise<boolean>; recentlyVisited(job: Job): Promise<boolean> }
function truncateUtf8(value: string, limit: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= limit) return { text: value, truncated: false };
  let cut = limit;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
  return { text: buf.subarray(0, cut).toString('utf8'), truncated: true };
}
export async function runImportWorker(deps: WorkerDeps): Promise<{ processed: number; cleaned: number }> {
  const started = deps.now(); let processed = 0; let cleaned = 0;
  async function read(id: string) { return deps.database.transaction(tx => tx.get<Job>('import_jobs', id)); }
  // A lost commit acknowledgment is resolved by reading, never by repeating a provider call.
  async function commit<T>(action: () => Promise<T>, recover: () => Promise<T>) {
    try { return await action(); } catch (error) { if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error; return recover(); }
  }
  function owns(job: Job | null, lease: string): job is Job { return !!job && job.state === 'running' && job.lease === lease && job.leaseUntil > deps.now(); }
  async function member(tx: TransactionPort, job: Job): Promise<FamilyContext | null> {
    const ctx = await readFamily(tx, job.uid);
    return ctx && ctx.familyId === job.familyId && ctx.generation === job.generation ? ctx : null;
  }
  async function end(tx: TransactionPort, job: Job, error: ImportError) {
    await settleCheckpoint(tx, job);
    await releaseImportMedia(tx, job.sourceMediaId, job._id, deps.now());
    await tx.replace('import_jobs', job._id, { ...job, state: 'failed', error, sourceText: null, sourceMediaId: null, sourceUrl: null, sourceWarnings: null, candidate: null, purgeAt: 0, lease: null, leaseUntil: 0, updatedAt: deps.now() } satisfies Job);
  }
  for (const id of await deps.reads.expired(deps.now())) {
    await commit(() => deps.database.transaction(async tx => {
      const job = await tx.get<Job>('import_jobs', id); if (!job || job.purgeAt <= 0 || job.purgeAt > deps.now()) return;
      if (!terminal(job.state)) await end(tx, job, 'INPUT_EXPIRED');
      else { await releaseImportMedia(tx, job.sourceMediaId, job._id, deps.now()); await tx.replace('import_jobs', id, { ...job, sourceText: null, sourceMediaId: null, sourceUrl: null, sourceWarnings: null, candidate: null, purgeAt: 0 }); }
    }), async () => { await read(id); }); cleaned++;
  }
  for (const id of await deps.reads.due(deps.now())) {
    if (processed >= 2 || deps.now() - started > 35000) break; // Leave 55s for a bounded provider call, audit and saving.
    const lease = deps.newId();
    const claim = () => deps.database.transaction(async tx => {
      const job = await tx.get<Job>('import_jobs', id);
      if (!job || terminal(job.state) || job.nextRunAt > deps.now() || job.state === 'running' && job.leaseUntil > deps.now()) return null;
      if (job.purgeAt <= deps.now()) { await end(tx, job, 'INPUT_EXPIRED'); return null; }
      if (!await member(tx, job)) { await end(tx, job, 'MEMBERSHIP_CHANGED'); return null; }
      if (!job.candidate && job.attempts >= 3) { await end(tx, job, 'PROVIDER_UNAVAILABLE'); return null; }
      const config = deps.config(); if (!job.candidate && (!config.enabled || ((job.sourceKind ?? 'text') === 'url' && !config.urlEnabled) || (job.sourceKind === 'image' && !config.imageEnabled))) return null;
      const row: Job = { ...job, state: 'running', lease, leaseUntil: deps.now() + 90000, nextRunAt: deps.now() + 90000, updatedAt: deps.now() };
      await tx.replace('import_jobs', id, row); return row;
    });
    const claimed = await commit(claim, async () => { const job = await read(id); return owns(job, lease) ? job : null; });
    if (!claimed) continue; processed++;
    let usageId = claimed.usageId; let usage = unknownUsage(); let candidate = claimed.candidate;
    try {
      if (candidate && usageId) {
        const previous = await deps.database.transaction(tx => tx.get<Usage>('ai_usage', usageId!));
        if (previous) usage = { inputTokens: previous.inputTokens, outputTokens: previous.outputTokens, costUsd: previous.costUsd, providerRequestId: previous.providerRequestId };
      }
      if (!await deps.activeUser(claimed.uid)) throw new ImportFailure('MEMBERSHIP_CHANGED', false, usage);
      if (!await deps.recentlyVisited(claimed)) throw new ImportFailure('AUDIT_VISIT_REQUIRED', false, usage);
      if (!candidate) {
        const attemptId = hash(['import-attempt-v1', id, lease]);
        const begin = () => deps.database.transaction(async tx => {
          const job = await tx.get<Job>('import_jobs', id); if (!owns(job, lease)) return false;
          if (job.purgeAt <= deps.now()) { await end(tx, job, 'INPUT_EXPIRED'); return false; }
          if (!await member(tx, job)) throw new ImportFailure('MEMBERSHIP_CHANGED');
          const config = deps.config(); if (!config.enabled) return false;
          const buckets = await reserve(tx, job, deps.now(), config, false);
          await tx.insert('ai_usage', attemptId, { _id: attemptId, jobId: id, attempt: job.attempts + 1, lease, currency: 'USD', reservedUsd: config.reserveUsd,
            ...unknownUsage(), settled: false, buckets, createdAt: deps.now() } satisfies Usage);
          await tx.replace('import_jobs', id, { ...job, attempts: job.attempts + 1, usageId: attemptId, updatedAt: deps.now() }); return true;
        });
        const began = await commit(begin, () => deps.database.transaction(async tx => {
          const job = await tx.get<Job>('import_jobs', id); return owns(job, lease) && !!await tx.get('ai_usage', attemptId);
        }));
        if (!began) continue;
        usageId = attemptId;
        usage = { ...unknownUsage(), costUsd: 0 };
        let providerInput: ProviderInput;
        let text = claimed.sourceText;
        if (claimed.sourceKind === 'image') {
          try {
            if (!claimed.sourceMediaId || !deps.storage) throw new Error();
            const row = await deps.database.transaction(async tx => {
              const ctx = await member(tx, claimed); if (!ctx) throw new ImportFailure('MEMBERSHIP_CHANGED');
              return requireImportMedia(tx, ctx, claimed.sourceMediaId!, deps.now(), claimed._id);
            });
            providerInput = await readImportImage(deps.storage, row);
          } catch (error) { if (error instanceof ImportFailure) throw error; throw new ImportFailure(claimed.purgeAt <= deps.now() ? 'INPUT_EXPIRED' : 'IMAGE_UNREADABLE'); }
        } else {
        if (text === null) {
          if ((claimed.sourceKind ?? 'text') !== 'url' || !claimed.sourceUrl) throw new ImportFailure('INPUT_EXPIRED');
          if (!deps.reader) throw new ImportFailure('SOURCE_UNREADABLE');
          let validated: ValidatedSource;
          try { validated = await validatePublicSource(claimed.sourceUrl, deps.resolve); }
          catch (error) { throw new ImportFailure('SOURCE_UNREADABLE', !(error instanceof AppError)); }
          const result = await deps.reader.read(validated);
          try { await validatePublicSource(result.sourceUrl, deps.resolve); }
          catch (error) { throw new ImportFailure('SOURCE_UNREADABLE', !(error instanceof AppError)); }
          if (!result.read || result.content === null) throw new ImportFailure('SOURCE_UNREADABLE');
          const warnings: string[] = [];
          const trimmed = truncateUtf8(result.content, 16384);
          text = trimmed.text;
          if (trimmed.truncated) warnings.push('网页正文超过 16 KiB，已截断，请核对保存后的菜谱。');
          if (result.sourceUrl !== validated.url) warnings.push('实际读取地址与提交网址不同：' + result.sourceUrl);
          // Checkpoint reader output so provider retries never pay for a second read.
          const storedText = await commit(() => deps.database.transaction(async tx => {
            const job = await tx.get<Job>('import_jobs', id); if (!owns(job, lease)) { await settle(tx, attemptId, usage); return false; }
            await tx.replace('import_jobs', id, { ...job, sourceText: text, sourceWarnings: warnings, updatedAt: deps.now() }); return true;
          }), async () => { const job = await read(id); return owns(job, lease) && job.sourceText !== null; });
          if (!storedText) { await recordUsage(attemptId, usage); continue; }
        }
        providerInput = text;
        }
        const canCall = await deps.database.transaction(async tx => {
          const job = await tx.get<Job>('import_jobs', id); if (!owns(job, lease)) return false;
          if (job.purgeAt <= deps.now()) throw new ImportFailure('INPUT_EXPIRED');
          const ctx = await member(tx, job); if (!ctx) throw new ImportFailure('MEMBERSHIP_CHANGED');
          if (job.sourceKind === 'image') {
            try { await requireImportMedia(tx, ctx, job.sourceMediaId!, deps.now(), job._id); }
            catch { throw new ImportFailure('IMAGE_UNREADABLE'); }
          }
          return true;
        });
        if (!canCall) { await recordUsage(attemptId, usage); continue; }
        usage = unknownUsage();
        const parsed = await deps.provider.parse(providerInput); usage = parsed.usage;
        try { candidate = recipeInput(parsed.recipe); } catch { throw new ImportFailure('INVALID_OUTPUT', false, usage); }
        const checked = candidate;
        // Persist validated fields before audit so an interrupted audit never needs another AI call.
        const stored = await commit(() => deps.database.transaction(async tx => {
          const job = await tx.get<Job>('import_jobs', id); if (!owns(job, lease)) { await settle(tx, attemptId, usage); return false; }
          const attempt = await tx.get<Usage>('ai_usage', attemptId); if (!attempt) throw new AppError('UNAVAILABLE');
          await tx.replace('ai_usage', attemptId, { ...attempt, ...usage });
          await tx.replace('import_jobs', id, { ...job, candidate: checked, updatedAt: deps.now() }); return true;
        }), async () => { const job = await read(id); return owns(job, lease) && job.candidate !== null; });
        if (!stored) { await recordUsage(attemptId, usage); continue; }
      }
      // Only normalized recipe fields reach the existing WeChat checker.
      if (claimed.purgeAt <= deps.now()) throw new ImportFailure('INPUT_EXPIRED', false, usage);
      let verdict: 'allowed' | 'rejected';
      try { verdict = await deps.content(claimed).checkText(auditText(candidate as RecipeInput)); }
      catch { throw new ImportFailure('AUDIT_UNAVAILABLE', false, usage); }
      if (verdict === 'rejected') throw new ImportFailure('AUDIT_REJECTED', false, usage);
      if (verdict !== 'allowed') throw new ImportFailure('AUDIT_UNAVAILABLE', false, usage);
      if (!await deps.activeUser(claimed.uid)) throw new ImportFailure('MEMBERSHIP_CHANGED', false, usage);
      await commit(() => deps.database.transaction(async tx => {
        const job = await tx.get<Job>('import_jobs', id);
        if (usageId) await settle(tx, usageId, usage);
        if (!owns(job, lease)) return;
        if (job.purgeAt <= deps.now()) { await end(tx, job, 'INPUT_EXPIRED'); return; }
        const ctx = await member(tx, job); if (!ctx) { await end(tx, job, 'MEMBERSHIP_CHANGED'); return; }
        if (job.sourceKind === 'image') {
          try { await requireImportMedia(tx, ctx, job.sourceMediaId!, deps.now(), job._id); }
          catch { await end(tx, job, 'IMAGE_UNREADABLE'); return; }
        }
        await guardMutation(tx, ctx);
        const recipeId = hash(['import-recipe-v1', id]).slice(0, 32);
        const sourceKind = job.sourceKind ?? 'text';
        await insertRecipe(tx, ctx, candidate as RecipeInput, recipeId, deps.now(), { kind: sourceKind, url: sourceKind === 'url' ? job.sourceUrl ?? null : null, importJobId: id, warnings: job.sourceWarnings ?? [] });
        await releaseImportMedia(tx, job.sourceMediaId, job._id, deps.now());
        await tx.replace('import_jobs', id, { ...job, state: 'succeeded', recipeId, sourceText: null, sourceMediaId: null, sourceUrl: null, sourceWarnings: null, candidate: null, purgeAt: 0, lease: null, leaseUntil: 0, updatedAt: deps.now() } satisfies Job);
      }), async () => { const job = await read(id); if (!job || !terminal(job.state)) throw new AppError('UNAVAILABLE'); });
    } catch (error) {
      const failure = error instanceof ImportFailure ? error : new ImportFailure(error instanceof AppError && error.code === 'QUOTA_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'PROVIDER_UNAVAILABLE', false, usage);
      if (!(error instanceof ImportFailure && failure.usage.costUsd === null && usage.costUsd !== null)) usage = failure.usage;
      await commit(() => deps.database.transaction(async tx => {
        if (usageId) await settle(tx, usageId, usage);
        const job = await tx.get<Job>('import_jobs', id); if (!owns(job, lease)) return;
        if (failure.retryable && job.attempts < 3) await tx.replace('import_jobs', id, { ...job, state: 'queued', lease: null, leaseUntil: 0, nextRunAt: deps.now() + (job.attempts === 1 ? 60000 : 120000), updatedAt: deps.now() } satisfies Job);
        else await end(tx, job, failure.code);
      }), async () => { await read(id); });
    }
  }
  if (deps.storage && deps.reads.mediaCleanup && deps.now() - started < 105000) cleaned += await cleanupImportMedia({ database: deps.database, storage: deps.storage, now: deps.now, ids: await deps.reads.mediaCleanup(deps.now()) });
  return { processed, cleaned };
  async function recordUsage(id: string, result: UsageResult) {
    await commit(() => deps.database.transaction(tx => settle(tx, id, result)), async () => { await deps.database.transaction(tx => tx.get('ai_usage', id)); });
  }
}
