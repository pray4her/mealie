import type { Id } from './identity';
import type { Mutation } from './family';
import type { Page } from './recipes';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'other';
export type PlanFields = { date: string; meal: MealType; targetServings: number | null };
export type PlanMutation = Mutation & { familyId: Id; generation: string };
export type PlanEntry = PlanFields & {
  id: Id; familyId: Id; createdBy: Id | null; recipeId: Id;
  titleSnapshot: string; version: number; createdAt: number; updatedAt: number;
  sourceAvailable: boolean; coverImageId: Id | null;
};
export type PlanAdd = PlanMutation & PlanFields & { recipeId: Id };
export type PlanUpdate = PlanMutation & PlanFields & { id: Id; version: number };
export type PlanRemove = PlanMutation & { id: Id; version: number };
export type PlanListInput = { from: string; to: string; cursor?: string; limit?: number };
export interface PlanningApi {
  add(input: PlanAdd): Promise<PlanEntry>;
  list(input: PlanListInput): Promise<Page<PlanEntry>>;
  get(id: Id): Promise<PlanEntry>;
  update(input: PlanUpdate): Promise<PlanEntry>;
  remove(input: PlanRemove): Promise<void>;
}
