import type { Id } from './identity';

export type Mutation = { requestId: string };
export type FamilyContext = { uid: Id; familyId: Id; role: 'owner' | 'member'; generation: Id };
export type FamilyView = FamilyContext & { name: string };
export type MembershipMutation = Mutation & Pick<FamilyContext, 'familyId' | 'generation'>;
export type MemberMutation = MembershipMutation & { uid: Id; targetGeneration: Id };
export type Invitation = { invitationId: Id; token: string; expiresAt: number };
export type InvitationView = { invitationId: Id; createdAt: number; expiresAt: number; status: 'pending' | 'used' | 'revoked' | 'expired' };
export type InvitationPage = { items: InvitationView[]; nextCursor?: string };
export type MemberView = { uid: Id; nickname: string; role: 'owner' | 'member'; generation: Id };
export interface FamilyApi {
  current(): Promise<FamilyView | null>;
  create(input: Mutation & { name: string }): Promise<FamilyView>;
  invite(input: Mutation): Promise<Invitation>;
  revokeInvite(input: Mutation & { invitationId: Id }): Promise<void>;
  join(input: Mutation & { token: string }): Promise<FamilyContext>;
  members(): Promise<MemberView[]>;
  invitations(input: { cursor?: string }): Promise<InvitationPage>;
  leave(input: MembershipMutation): Promise<void>;
  removeMember(input: MemberMutation): Promise<void>;
  transferOwner(input: MemberMutation): Promise<FamilyContext>;
}
