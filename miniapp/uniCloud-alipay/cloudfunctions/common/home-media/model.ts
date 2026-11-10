import type { FamilyContext, MediaMime, MediaPurpose, MediaState, MediaView } from 'home-contracts';
import type { TransactionPort } from 'home-kernel';
import { AppError } from 'home-kernel';

export type MediaRecord = {
  _id: string; uid: string; familyId: string; generation: string; sessionHash: string; requestId: string; payloadHash: string;
  purpose: MediaPurpose; mime: MediaMime; bytes: number; sha256: string | null; fileId: string | null; cloudPath: string | null;
  state: MediaState; review: MediaView['review']; uploadExpiresAt: number; createdAt: number; updatedAt: number;
  leaseUntil: number; attempt: string | null; traceId: string | null; reviewExpiresAt: number | null;
  recipeId: string | null; cleanupAt: number | null; garbagePaths: string[];
};
export function mediaView(row: MediaRecord): MediaView {
  return { mediaId: row._id, state: row.state, uploadExpiresAt: row.uploadExpiresAt, review: row.review, retryable: row.state === 'review-error' || row.state === 'uploaded' };
}
export async function mediaRecord(tx: TransactionPort, id: string): Promise<MediaRecord> {
  const row = await tx.get<MediaRecord>('media_files', id);
  if (!row || row._id !== id) throw new AppError('NOT_FOUND');
  return row;
}
export async function visibleMedia(tx: TransactionPort, ctx: FamilyContext, id: string, manage = false): Promise<MediaRecord> {
  const row = await mediaRecord(tx, id);
  if (row.familyId !== ctx.familyId) throw new AppError('NOT_FOUND');
  if (!manage && row.purpose === 'recipe-image' && row.recipeId && row.state === 'ready') {
    const recipe = await tx.get<{ familyId: string; imageIds: string[] }>('recipes', row.recipeId);
    if (recipe?.familyId === ctx.familyId && recipe.imageIds.includes(id)) return row;
  }
  if (row.uid !== ctx.uid || row.generation !== ctx.generation) throw new AppError('NOT_FOUND');
  return row;
}
