import { createHash } from 'node:crypto';
import type { ImportError, ImportState, JobView, RecipeInput } from 'home-contracts';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const jobId = (uid: string, familyId: string, generation: string, requestId: string) => hash(['import-v1', uid, familyId, generation, requestId]).slice(0, 32);
export type Job = {
  _id: string; uid: string; familyId: string; generation: string; requestId: string; payloadHash: string;
  state: ImportState; attempts: number; recipeId: string | null; error: ImportError | null; createdAt: number; updatedAt: number;
  sourceText: string | null; sourceKind?: 'text' | 'url'; sourceUrl?: string | null; sourceWarnings?: string[] | null; purgeAt: number; nextRunAt: number; lease: string | null; leaseUntil: number;
  candidate: RecipeInput | null; usageId: string | null; taskBuckets: string[]; visitedAt: number;
};
export type Usage = { _id: string; jobId: string; attempt: number; lease: string; currency: 'USD'; reservedUsd: number; costUsd: number | null;
  inputTokens: number | null; outputTokens: number | null; providerRequestId: string | null; settled: boolean; buckets: string[]; createdAt: number };
export const terminal = (state: ImportState) => state === 'succeeded' || state === 'failed' || state === 'cancelled';
export const jobView = (job: Job): JobView => ({ id: job._id, state: job.state, attempts: job.attempts, recipeId: job.recipeId, createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.error });
export type ImportConfig = { enabled: boolean; urlEnabled: boolean; userTasks: number | null; familyTasks: number | null; userUsd: number | null; familyUsd: number | null; globalUsd: number | null; reserveUsd: number };
export const defaultConfig = (): ImportConfig => ({ enabled: false, urlEnabled: false, userTasks: null, familyTasks: null, userUsd: null, familyUsd: null, globalUsd: null, reserveUsd: 1 });
export function importConfig(env: Record<string, string | undefined>): ImportConfig {
  function limit(key: string): number | null {
    if (env[key] === undefined || env[key] === 'unlimited') return null;
    const value = Number(env[key]); if (!env[key]?.trim() || !Number.isFinite(value) || value < 0) throw new Error('Invalid import configuration'); return value;
  }
  const reserveUsd = env.IMPORTS_RESERVE_USD === undefined ? 1 : Number(env.IMPORTS_RESERVE_USD);
  if (!Number.isFinite(reserveUsd) || reserveUsd <= 0) throw new Error('Invalid import configuration');
  return { enabled: env.IMPORTS_ENABLED === 'true', urlEnabled: env.IMPORTS_URL_ENABLED === 'true', userTasks: limit('IMPORTS_USER_TASKS'), familyTasks: limit('IMPORTS_FAMILY_TASKS'),
    userUsd: limit('IMPORTS_USER_USD'), familyUsd: limit('IMPORTS_FAMILY_USD'), globalUsd: limit('IMPORTS_GLOBAL_USD'), reserveUsd };
}
