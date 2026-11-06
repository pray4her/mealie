export { currentFamily } from './current';
export { readFamily } from './repository';
export { requireFamily, guardMutation } from './membership';
export { createWeixinContentPort } from './weixin-content';
import type { FamilyApi, Identity } from 'home-contracts';
import type { ContentPort, DatabasePort } from 'home-kernel';
import { consumeRequestLimit, safeError } from 'home-kernel';
import { currentFamily } from './current';
import { createFamily } from './create';

export interface FamilyDeps {
  database: DatabasePort; now: () => number; newId: () => string;
  content: ContentPort; revalidateIdentity: () => Promise<void>;
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
  };
}
