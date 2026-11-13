import type { FamilyContext, MediaApi, MediaLink, MediaView } from 'home-contracts';
import type {} from './platform';
import { AppError, consumeRequestLimit, DatabaseFault, safeError } from 'home-kernel';
import type { DatabasePort, TransactionPort } from 'home-kernel';
import { guardMutation, readFamily } from 'home-family';
import { decodeFile, digest, validateFile } from './files';
import { mediaRecord, mediaView, visibleMedia } from './model';
import type { MediaRecord } from './model';
import { exact, mediaId, mediaIds, uploadMetadata } from './validation';
export { createStoragePort } from './storage';
export type { StoragePlatform } from './storage';
export { createWeixinMediaReview } from './review';
export { handleReviewNotification, receiveReview } from './callback';
export type { MediaRecord } from './model';
export { mediaRecord } from './model';
export { bindRecipeMedia } from './binding';
export { requireImportMedia, releaseImportMedia, importMediaExpiry, readImportImage, cleanupImportMedia } from './imports';

export interface StoragePort {
  upload(path: string, bytes: Buffer): Promise<string>;
  read(fileId: string): Promise<Buffer>;
  sign(fileId: string): Promise<Omit<MediaLink, 'mediaId'>>;
  remove(paths: string[]): Promise<void>;
}
export interface MediaReviewPort { mode: MediaView['review']; submit(row: MediaRecord, url: string): Promise<string> }
export interface MediaDeps {
  database: DatabasePort; storage: StoragePort; review: MediaReviewPort; sessionHash: string;
  now(): number; newId(): string; revalidateIdentity(): Promise<void>;
}
export function createMediaService(deps: MediaDeps, ctx: FamilyContext): MediaApi {
  async function confirm(tx: TransactionPort) {
    const current = await readFamily(tx, ctx.uid);
    if (!current) throw new AppError('FAMILY_REQUIRED');
    if (current.familyId !== ctx.familyId || current.generation !== ctx.generation) throw new AppError('CONFLICT');
  }
  async function prepare(raw: unknown, keys: string[], write = false) {
    const row = exact(raw, ['familyId', 'generation', ...keys]);
    if (row.familyId !== ctx.familyId || row.generation !== ctx.generation) throw new AppError('CONFLICT');
    await deps.revalidateIdentity(); await deps.database.transaction(confirm);
    await consumeRequestLimit(deps.database, { subject: 'uid:' + ctx.uid, operation: write ? 'media:write' : 'media:read', now: deps.now(), max: write ? 60 : 120 });
    await consumeRequestLimit(deps.database, { subject: 'family:' + ctx.familyId, operation: write ? 'media:write' : 'media:read', now: deps.now(), max: write ? 300 : 600 });
    return row;
  }
  async function finish<T>(value: T): Promise<T> {
    await deps.revalidateIdentity(); await deps.database.transaction(confirm); return value;
  }
  async function failure(id: string, attempt: string, state: 'failed' | 'review-error') {
    await deps.database.transaction(async tx => {
      const row = await mediaRecord(tx, id);
      if (row.attempt === attempt && ['uploading', 'checking'].includes(row.state)) await tx.replace('media_files', id,
        { ...row, state, updatedAt: deps.now(), cleanupAt: deps.now() + 86_400_000 });
    }).catch(() => {});
  }
  async function requestUpload(raw: unknown): Promise<MediaView> {
    const input = await prepare(raw, ['requestId', 'purpose', 'mime', 'bytes'], true); uploadMetadata(input);
    const id = digest(JSON.stringify(['media-v1', ctx.uid, ctx.familyId, ctx.generation, input.requestId])).slice(0, 32);
    const payloadHash = digest(JSON.stringify([input.purpose, input.mime, input.bytes]));
    const execute = () => deps.database.transaction(async tx => {
      await confirm(tx); const old = await tx.get<MediaRecord>('media_files', id);
      if (old) { if (old.payloadHash !== payloadHash) throw new AppError('CONFLICT'); return mediaView(old); }
      await guardMutation(tx, ctx);
      const row: MediaRecord = { _id: id, uid: ctx.uid, familyId: ctx.familyId, generation: ctx.generation, sessionHash: deps.sessionHash, requestId: input.requestId as string, payloadHash,
        purpose: input.purpose as MediaRecord['purpose'], mime: input.mime as MediaRecord['mime'], bytes: input.bytes as number,
        sha256: null, fileId: null, cloudPath: null, state: 'requested', review: deps.review.mode, uploadExpiresAt: deps.now() + 300_000,
        createdAt: deps.now(), updatedAt: deps.now(), leaseUntil: 0, attempt: null, traceId: null, reviewExpiresAt: null, recipeId: null,
        cleanupAt: deps.now() + (input.purpose === 'import-input' ? 7 : 1) * 86_400_000, garbagePaths: [] };
      await tx.insert('media_files', id, row); return mediaView(row);
    });
    try { return await finish(await execute()); }
    catch (error) { if (!(error instanceof DatabaseFault) || error.kind !== 'commit-unknown') throw error; return finish(await execute()); }
  }
  async function upload(raw: unknown): Promise<MediaView> {
    const input = await prepare(raw, ['mediaId', 'base64'], true); const id = mediaId(input.mediaId);
    const old = await deps.database.transaction(async tx => { await confirm(tx); return visibleMedia(tx, ctx, id, true); });
    const file = decodeFile(input.base64, old.mime, old.bytes);
    if (old.sha256 && old.sha256 !== file.sha256) throw new AppError('CONFLICT');
    if (['uploaded', 'checking', 'pending', 'ready', 'review-error', 'rejected'].includes(old.state)) return finish(mediaView(old));
    const attempt = mediaId(deps.newId());
    const path = 'task07-private/' + id + '/' + attempt + (old.mime === 'image/png' ? '.png' : '.jpg');
    try {
      await deps.database.transaction(async tx => {
        await guardMutation(tx, ctx); const row = await visibleMedia(tx, ctx, id, true);
        if (row.sha256 && row.sha256 !== file.sha256) throw new AppError('CONFLICT');
        if (row.uploadExpiresAt <= deps.now() || row.state === 'failed') throw new AppError('INVALID_INPUT');
        if (row.state !== 'requested' && !(row.state === 'uploading' && row.leaseUntil <= deps.now())) throw new AppError('UNAVAILABLE');
        await tx.replace('media_files', id, { ...row, state: 'uploading', attempt, cloudPath: path, sha256: file.sha256,
          leaseUntil: deps.now() + 60_000, updatedAt: deps.now(), garbagePaths: [...row.garbagePaths, path] });
      });
      const fileId = await deps.storage.upload(path, file.bytes);
      await deps.revalidateIdentity();
      const result = await deps.database.transaction(async tx => {
        await guardMutation(tx, ctx); const row = await visibleMedia(tx, ctx, id, true);
        if (row.state !== 'uploading' || row.attempt !== attempt || row.uploadExpiresAt <= deps.now()) throw new AppError('CONFLICT');
        const uploaded: MediaRecord = { ...row, fileId, state: 'uploaded', updatedAt: deps.now(), leaseUntil: 0, garbagePaths: row.garbagePaths.filter(value => value !== path) };
        await tx.replace('media_files', id, uploaded); return mediaView(uploaded);
      });
      return finish(result);
    } catch (error) {
      if (error instanceof DatabaseFault && error.kind === 'commit-unknown') {
        const recovered = await deps.database.transaction(async tx => { await confirm(tx); return visibleMedia(tx, ctx, id, true); });
        if (recovered.state === 'uploaded' && recovered.attempt === attempt) return finish(mediaView(recovered));
      }
      await failure(id, attempt, 'failed'); throw error;
    }
  }
  async function complete(raw: unknown): Promise<MediaView> {
    const input = await prepare(raw, ['mediaId'], true); const id = mediaId(input.mediaId); const attempt = mediaId(deps.newId());
    const selected = await deps.database.transaction(async tx => {
      await guardMutation(tx, ctx); const row = await visibleMedia(tx, ctx, id, true);
      if (['ready', 'pending', 'rejected', 'failed'].includes(row.state)) return { row, claimed: false };
      if (!['uploaded', 'review-error'].includes(row.state)) throw new AppError('UNAVAILABLE');
      const checking: MediaRecord = { ...row, state: 'checking', attempt, leaseUntil: deps.now() + 60_000, updatedAt: deps.now() };
      await tx.replace('media_files', id, checking); return { row: checking, claimed: true };
    });
    if (!selected.claimed) return finish(mediaView(selected.row));
    let verified = false;
    try {
      const row = selected.row;
      if (!row.fileId || !row.sha256) throw new AppError('UNAVAILABLE');
      const bytes = await deps.storage.read(row.fileId);
      if (validateFile(bytes, row.mime, row.bytes) !== row.sha256) throw new AppError('INVALID_INPUT');
      verified = true; await deps.revalidateIdentity();
      await deps.database.transaction(tx => guardMutation(tx, ctx));
      let traceId: string | null = null;
      if (row.review !== 'disabled') {
        if (row.review !== deps.review.mode) throw new AppError('UNAVAILABLE');
        traceId = await deps.review.submit(row, (await deps.storage.sign(row.fileId)).url);
        if (typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(traceId)) throw new AppError('UNAVAILABLE');
      }
      await deps.revalidateIdentity();
      const result = await deps.database.transaction(async tx => {
        await guardMutation(tx, ctx); const current = await visibleMedia(tx, ctx, id, true);
        if (current.state !== 'checking' || current.attempt !== attempt || current.leaseUntil <= deps.now()) throw new AppError('CONFLICT');
        const next: MediaRecord = { ...current, state: traceId ? 'pending' : 'ready', traceId,
          reviewExpiresAt: traceId ? deps.now() + 1_800_000 : null, updatedAt: deps.now(), leaseUntil: 0 };
        if (traceId) await tx.insert('media_audit_traces', digest(traceId), { _id: digest(traceId), traceId, mediaId: id, attempt, verdict: null });
        await tx.replace('media_files', id, next); return mediaView(next);
      });
      return finish(result);
    } catch (error) {
      if (error instanceof DatabaseFault && error.kind === 'commit-unknown') {
        const row = await deps.database.transaction(async tx => { await confirm(tx); return visibleMedia(tx, ctx, id, true); });
        if (row.attempt === attempt && ['pending', 'ready'].includes(row.state)) return finish(mediaView(row));
      }
      await failure(id, attempt, verified && !['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'CONFLICT'].includes(safeError(error).code) ? 'review-error' : 'failed'); throw error;
    }
  }
  async function status(raw: unknown) {
    const input = await prepare(raw, ['mediaIds']); const ids = mediaIds(input.mediaIds);
    const rows = await deps.database.transaction(async tx => {
      await confirm(tx); const result: MediaView[] = [];
      for (const id of ids) {
        let row = await visibleMedia(tx, ctx, id);
        const expired = row.state === 'pending' && row.reviewExpiresAt !== null && row.reviewExpiresAt <= deps.now();
        const stalled = row.state === 'checking' && row.leaseUntil <= deps.now();
        if (expired || stalled) {
          await guardMutation(tx, ctx); row = { ...row, state: 'review-error', updatedAt: deps.now(), cleanupAt: deps.now() + 86_400_000 };
          await tx.replace('media_files', id, row);
        }
        result.push(mediaView(row));
      }
      return result;
    });
    return finish(rows);
  }
  async function read(raw: unknown): Promise<MediaLink> {
    const input = await prepare(raw, ['mediaId']); const id = mediaId(input.mediaId);
    const row = await deps.database.transaction(async tx => { await confirm(tx); return visibleMedia(tx, ctx, id); });
    if (row.purpose !== 'recipe-image' || row.state !== 'ready' || !row.fileId) throw new AppError('INVALID_INPUT');
    const link = await deps.storage.sign(row.fileId);
    await deps.revalidateIdentity();
    await deps.database.transaction(async tx => { await confirm(tx); const current = await visibleMedia(tx, ctx, id); if (current.state !== 'ready' || current.fileId !== row.fileId) throw new AppError('CONFLICT'); });
    return { mediaId: id, ...link };
  }
  return {
    async requestUpload(input) { try { return await requestUpload(input); } catch (error) { throw safeError(error); } },
    async upload(input) { try { return await upload(input); } catch (error) { throw safeError(error); } },
    async complete(input) { try { return await complete(input); } catch (error) { throw safeError(error); } },
    async status(input) { try { return await status(input); } catch (error) { throw safeError(error); } },
    async read(input) { try { return await read(input); } catch (error) { throw safeError(error); } },
  };
}
