import { AppError } from 'home-kernel';
import type { TransactionPort } from 'home-kernel';
import type { ImportConfig, Job, Usage } from './model';
import { hash } from './model';
export type Bucket = { _id: string; tasks: number; heldUsd: number; spentUsd: number; day: number };
function keys(job: Pick<Job, 'uid' | 'familyId'>, now: number) {
  const day = Math.floor(now / 86400000); return { day, ids: [hash(['import-quota-v1', day, 'user', job.uid]), hash(['import-quota-v1', day, 'family', job.familyId]), hash(['import-quota-v1', day, 'global'])] };
}
export async function reserve(tx: TransactionPort, job: Pick<Job, 'uid' | 'familyId'>, now: number, config: ImportConfig, task: boolean): Promise<string[]> {
  const { day, ids } = keys(job, now); const limits = task ? [config.userTasks, config.familyTasks] : [config.userUsd, config.familyUsd, config.globalUsd];
  for (const [i, limit] of limits.entries()) {
    const row = await tx.get<Bucket>('quota_buckets', ids[i]); const bucket = row ?? { _id: ids[i], day, tasks: 0, heldUsd: 0, spentUsd: 0 };
    if (limit !== null && (task ? bucket.tasks + 1 : bucket.spentUsd + bucket.heldUsd + config.reserveUsd) > limit + 1e-9) throw new AppError('QUOTA_EXCEEDED');
    if (task) bucket.tasks++; else bucket.heldUsd += config.reserveUsd;
    if (row) await tx.replace('quota_buckets', bucket._id, bucket); else await tx.insert('quota_buckets', bucket._id, bucket);
  }
  return ids.slice(0, limits.length);
}
export type UsageResult = { inputTokens: number | null; outputTokens: number | null; costUsd: number | null; providerRequestId: string | null };
export async function settleCheckpoint(tx: TransactionPort, job: Job): Promise<void> {
  if (!job.candidate || !job.usageId) return;
  const usage = await tx.get<Usage>('ai_usage', job.usageId); if (!usage) throw new AppError('UNAVAILABLE');
  await settle(tx, usage._id, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd, providerRequestId: usage.providerRequestId });
}
export async function settle(tx: TransactionPort, usageId: string, result: UsageResult): Promise<void> {
  const usage = await tx.get<Usage>('ai_usage', usageId);
  if (!usage || usage.settled && (usage.costUsd !== null || result.costUsd === null)) return;
  for (const id of usage.buckets) {
    const bucket = await tx.get<Bucket>('quota_buckets', id); if (!bucket) throw new AppError('UNAVAILABLE');
    if (result.costUsd !== null) { bucket.heldUsd = Math.max(0, bucket.heldUsd - usage.reservedUsd); bucket.spentUsd += result.costUsd; }
    await tx.replace('quota_buckets', id, bucket);
  }
  await tx.replace('ai_usage', usageId, { ...usage, ...result, settled: true });
}
