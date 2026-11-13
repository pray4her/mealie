import type { FamilyContext } from 'home-contracts';
import { AppError } from 'home-kernel';
import type { DatabasePort, TransactionPort } from 'home-kernel';
import type { StoragePort } from './index';
import { visibleMedia, mediaRecord } from './model';
import type { MediaRecord } from './model';
import { validateFile } from './files';

export const importMediaExpiry = (row: { createdAt: number }) => row.createdAt + 7 * 86400000;
export async function requireImportMedia(tx: TransactionPort, ctx: FamilyContext, id: string, now: number, jobId?: string) {
  const row = await visibleMedia(tx, ctx, id, true);
  if (row.purpose !== 'import-input') throw new AppError('INVALID_INPUT');
  if (row.importJobId && row.importJobId !== jobId) throw new AppError('CONFLICT');
  if (row.state !== 'ready' || row.review === 'disabled' || !row.fileId || !row.sha256 || importMediaExpiry(row) <= now) throw new AppError('INVALID_INPUT');
  return row;
}
export async function releaseImportMedia(tx: TransactionPort, mediaId: string | null | undefined, jobId: string, now: number) {
  if (!mediaId) return;
  const row = await tx.get<MediaRecord>('media_files', mediaId);
  if (row?.purpose === 'import-input' && row.importJobId === jobId) await tx.replace('media_files', mediaId, { ...row, cleanupAt: now, updatedAt: now });
}
export async function readImportImage(storage: StoragePort, row: Awaited<ReturnType<typeof requireImportMedia>>) {
  const bytes = await bounded(storage.read(row.fileId!), 5000);
  if (validateFile(bytes, row.mime, row.bytes) !== row.sha256) throw new AppError('INVALID_INPUT');
  return { kind: 'image' as const, mime: row.mime, base64: bytes.toString('base64') };
}
async function bounded<T>(operation: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('UNAVAILABLE')), timeout); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export async function cleanupImportMedia(deps: { database: DatabasePort; storage: StoragePort; now(): number; ids: string[] }) {
  const started = Date.now(); let cleaned = 0;
  for (const id of deps.ids.slice(0, 20)) {
    if (Date.now() - started >= 5000) break;
    const selected = await deps.database.transaction(async tx => {
      const row = await mediaRecord(tx, id);
      if (row.purpose !== 'import-input' || row.cleanupAt === null || row.cleanupAt > deps.now() || row.state === 'uploading' && row.leaseUntil > deps.now()) return null;
      // Invalidate before I/O; keep the upload receipt so replay cannot recreate deleted input.
      const next = { ...row, state: 'failed' as const, cleanupAt: deps.now() + 300000, updatedAt: deps.now() };
      await tx.replace('media_files', id, next); return next;
    });
    if (!selected) continue;
    try {
      const paths = [...new Set([...(selected.fileId ? [selected.fileId] : []), ...selected.garbagePaths])];
      const expected = new RegExp('^(?:cloud://[^/]+/)?task07-private/' + id + '/[a-f0-9]{32}\\.(?:png|jpg)$');
      if (paths.some(path => !expected.test(path))) throw new AppError('UNAVAILABLE');
      if (paths.length) await bounded(deps.storage.remove(paths), Math.max(1, Math.min(2000, 5000 - (Date.now() - started))));
      await deps.database.transaction(async tx => {
        const row = await mediaRecord(tx, id);
        if (row.state !== 'failed' || row.attempt !== selected.attempt || row.updatedAt !== selected.updatedAt) return;
        await tx.replace('media_files', id, { ...row, fileId: null, cloudPath: null, sha256: null, garbagePaths: [], cleanupAt: null });
      }); cleaned++;
    } catch { /* The persisted next attempt lets other overdue inputs make progress. */ }
  }
  return cleaned;
}
