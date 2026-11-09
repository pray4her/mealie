export { currentFamily } from './current';
export { readFamily } from './repository';
export { requireFamily, guardMutation } from './membership';
export { createWeixinContentPort } from './weixin-content';
export { createInvitationTokens } from './invitation-token';
export { createFamilyReads } from './family-reads';
export type { FamilyReads, FamilyReadPlatform } from './family-reads';
import type { FamilyApi, Identity } from 'home-contracts';
import type { ContentPort, DatabasePort } from 'home-kernel';
import { consumeRequestLimit, safeError } from 'home-kernel';
import { currentFamily } from './current';
import { createFamily } from './create';
import { inviteMember, revokeInvitation, joinFamily } from './invitations';
import { listInvitations, listMembers } from './family-reads';
import { leaveFamily, removeFamilyMember, transferFamilyOwner } from './membership-actions';
import type { InvitationTokens } from './invitation-token';
import type { FamilyReads } from './family-reads';

export interface FamilyDeps {
  database: DatabasePort; now: () => number; newId: () => string;
  content: ContentPort; revalidateIdentity: () => Promise<void>;
  invitationTokens?: InvitationTokens; familyReads?: FamilyReads;
}
export function createFamilyService(deps: FamilyDeps, identity: Identity): FamilyApi {
  return {
    async current() {
      try {
        await consumeRequestLimit(deps.database, { subject: `uid:${identity.uid}`, operation: 'family:current', now: deps.now(), max: 60 });
        const current = await currentFamily(deps.database, identity);
        if (current) await consumeRequestLimit(deps.database, { subject: `family:${current.familyId}`, operation: 'family:current', now: deps.now(), max: 300 });
        return current;
      } catch (error) { throw safeError(error); }
    },
    async create(input) { try { return await createFamily(deps, identity, input); } catch (error) { throw safeError(error); } },
    async invite(input) { try { return await inviteMember(deps, identity, input); } catch (error) { throw safeError(error); } },
    async revokeInvite(input) { try { await revokeInvitation(deps, identity, input); } catch (error) { throw safeError(error); } },
    async join(input) { try { return await joinFamily(deps, identity, input); } catch (error) { throw safeError(error); } },
    async members() { try { return await listMembers(deps, identity); } catch (error) { throw safeError(error); } },
    async invitations(input) { try { return await listInvitations(deps, identity, input); } catch (error) { throw safeError(error); } },
    async leave(input) { try { await leaveFamily(deps, identity, input); } catch (error) { throw safeError(error); } },
    async removeMember(input) { try { await removeFamilyMember(deps, identity, input); } catch (error) { throw safeError(error); } },
    async transferOwner(input) { try { return await transferFamilyOwner(deps, identity, input); } catch (error) { throw safeError(error); } },
  };
}
