import { AppError } from 'home-kernel';
export interface ImportReads { due(now: number): Promise<string[]>; expired(now: number): Promise<string[]>; mediaCleanup?(now: number): Promise<string[]> }
interface Query { where(filter: Record<string, unknown>): Query; field(fields: Record<string, boolean>): Query; orderBy(field: string, order: 'asc'): Query; limit(count: number): Query; get(): Promise<unknown> }
export interface ImportReadPlatform { command: { lte(value: number): unknown; gt(value: number): unknown; and(values: Record<string, unknown>[]): Record<string, unknown> }; collection(name: string): Query }
export function createImportReads(platform: ImportReadPlatform): ImportReads {
  async function ids(filter: Record<string, unknown>, sort: string, limit: number, collection = 'import_jobs') {
    const result = await platform.collection(collection).where(filter).field({ _id: true }).orderBy(sort, 'asc').orderBy('_id', 'asc').limit(limit).get();
    if (!result || typeof result !== 'object' || 'errCode' in result && result.errCode !== 0 || !('data' in result) || !Array.isArray(result.data)
      || result.data.length > limit || result.data.some(row => !row || typeof row !== 'object' || typeof row._id !== 'string' || !/^[a-f0-9]{32}$/.test(row._id))) throw new AppError('UNAVAILABLE');
    return result.data.map(row => row._id as string);
  }
  return { async due(now) {
    const queued = await ids({ state: 'queued', nextRunAt: platform.command.lte(now) }, 'nextRunAt', 2);
    const running = await ids({ state: 'running', nextRunAt: platform.command.lte(now) }, 'nextRunAt', 2);
    return [...running, ...queued];
  }, expired(now) { return ids(platform.command.and([{ purgeAt: platform.command.gt(0) }, { purgeAt: platform.command.lte(now) }]), 'purgeAt', 20); },
  mediaCleanup(now) { return ids(platform.command.and([{ purpose: 'import-input' }, { cleanupAt: platform.command.gt(0) }, { cleanupAt: platform.command.lte(now) }]), 'cleanupAt', 20, 'media_files'); } };
}
