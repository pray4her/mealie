import type { FamilyContext } from 'home-contracts';
import type { TransactionPort } from 'home-kernel';
import { AppError } from 'home-kernel';
import { mediaRecord } from './model';
export async function bindRecipeMedia(tx: TransactionPort, ctx: FamilyContext, recipeId: string, before: string[], after: string[], now: number) {
  for (const id of after) {
    const row = await mediaRecord(tx, id);
    if (row.familyId !== ctx.familyId) throw new AppError('NOT_FOUND');
    if (row.purpose !== 'recipe-image' || row.state !== 'ready'
      || (row.recipeId !== recipeId && (row.recipeId !== null || row.uid !== ctx.uid || row.generation !== ctx.generation))) throw new AppError('INVALID_INPUT');
    await tx.replace('media_files', id, { ...row, recipeId, cleanupAt: null, updatedAt: now });
  }
  for (const id of before.filter(id => !after.includes(id))) {
    const row = await mediaRecord(tx, id);
    if (row.familyId !== ctx.familyId || row.recipeId !== recipeId) throw new AppError('UNAVAILABLE');
    await tx.replace('media_files', id, { ...row, recipeId: null, cleanupAt: now + 86_400_000, updatedAt: now });
  }
}
