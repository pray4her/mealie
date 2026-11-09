import type { Id } from './identity';
import type { MembershipMutation } from './family';

export type Ingredient = { raw: string; name: string; quantity: number | null; unit: string | null; note: string | null };
export type RecipeInput = {
  title: string; description: string | null; baseServings: number | null; prepMinutes: number | null; cookMinutes: number | null;
  ingredients: Ingredient[]; steps: string[]; tags: string[];
};
export type RecipeSource = { kind: 'manual' | 'text' | 'image' | 'url'; url: string | null; importJobId: Id | null; warnings: string[] };
export type Recipe = RecipeInput & {
  id: Id; familyId: Id; createdBy: Id | null; version: number; createdAt: number; updatedAt: number;
  imageIds: Id[]; source: RecipeSource; authorLabel: string; isFavorite: boolean;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type RecipeMutation = MembershipMutation & { recipe: RecipeInput };
export type RecipeUpdate = RecipeMutation & { id: Id; version: number };
export type RecipeListInput = { query?: string; tag?: string; cursor?: string; limit?: number; favoritesOnly?: boolean };
export type RecipeFavoriteMutation = MembershipMutation & { id: Id; enabled: boolean };
export interface RecipesApi {
  create(input: RecipeMutation): Promise<Recipe>;
  get(id: Id): Promise<Recipe>;
  list(input: RecipeListInput): Promise<Page<Recipe>>;
  update(input: RecipeUpdate): Promise<Recipe>;
  favorite(input: RecipeFavoriteMutation): Promise<void>;
}
