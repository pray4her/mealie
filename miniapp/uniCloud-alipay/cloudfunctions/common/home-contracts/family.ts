import type { Id } from './identity';

export type Mutation = { requestId: string };
export type FamilyContext = { uid: Id; familyId: Id; role: 'owner' | 'member'; generation: Id };
export type FamilyView = FamilyContext & { name: string };
export interface FamilyApi {
  current(): Promise<FamilyView | null>;
  create(input: Mutation & { name: string }): Promise<FamilyView>;
}
