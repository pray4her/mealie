import type { FamilyContext, RecipeInput, RecipeSource } from 'home-contracts';
import type { TransactionPort } from 'home-kernel';
import { recipeId, recipeInput } from './validation';
import type { RecipeRecord } from './repository';

/** Caller must audit text and guard membership in the same saving transaction. */
export async function insertRecipe(tx: TransactionPort, ctx: FamilyContext, input: RecipeInput, id: string, timestamp: number,
  source: RecipeSource = { kind: 'manual', url: null, importJobId: null, warnings: [] }): Promise<RecipeRecord> {
  recipeId(id); const recipe = recipeInput(input);
  const prefix = [...recipe.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')].slice(0, 80).join('') || 'recipe';
  const row: RecipeRecord = { ...recipe, _id: id, slug: prefix + '-' + id, familyId: ctx.familyId, createdBy: ctx.uid, version: 1,
    createdAt: timestamp, updatedAt: timestamp, imageIds: [], source };
  await tx.insert('recipes', id, row); return row;
}
