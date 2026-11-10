import { inject } from 'vue';
import type { App, InjectionKey } from 'vue';
import type { AppClient } from 'home-contracts';
import { createAuthController } from '../features/auth/use-auth';
import { createFamilyController } from '../features/family/use-family';
import { createFamilyIntentStore, newRequestId } from '../features/family/intents';
import { createInvitationIntents } from '../features/family/invitation-intents';
import { createInvitationController } from '../features/family/use-invitations';
import { createMembershipIntents } from '../features/family/membership-intents';
import { createMembershipController } from '../features/family/use-membership';
import { createRecipesController } from '../features/recipes/use-recipes';
import { createMediaController } from '../features/media/use-media';
import { createImportsController } from '../features/imports/use-imports';
import type { SessionStorage } from './session-boundary';

type ControllerOptions = { storage?: SessionStorage; newRequestId?: () => Promise<string> };
function createAppControllers(client: AppClient, options: ControllerOptions) {
  const auth = createAuthController(client.account);
  const storage = options.storage ?? {
    get: (key: string) => uni.getStorageSync(key), set: (key: string, value: unknown) => { uni.setStorageSync(key, value); }, remove: (key: string) => { uni.removeStorageSync(key); },
  };
  const creations = createFamilyIntentStore(storage); const invitationIntents = createInvitationIntents(storage); const membershipIntents = createMembershipIntents(storage);
  const random = options.newRequestId ?? newRequestId;
  const family = createFamilyController({ api: client.family, account: client.account, auth, intents: creations, newRequestId: random, hasPendingJoin: uid => !!invitationIntents.read(uid, 'join') || !!membershipIntents.read(uid) });
  const invitations = createInvitationController({ api: client.family, auth, family, intents: invitationIntents, creations, newRequestId: random });
  const recipes = createRecipesController({ api: client.recipes, auth, family, storage, newRequestId: random });
  const media = createMediaController({ api: client.media, recipes: client.recipes, auth, family, storage, newRequestId: random });
  const imports = createImportsController({ api: client.imports, auth, family, storage, newRequestId: random });
  const membership = createMembershipController({ api: client.family, auth, family, intents: membershipIntents, newRequestId: random, invalidate() { family.clear(); invitations.conceal(); recipes.clear(); media.clear(); imports.clear(); } });
  return { client, auth, family, invitations, membership, recipes, media, imports };
}
export const appClientKey: InjectionKey<ReturnType<typeof createAppControllers>> = Symbol('home-app-client');
export function provideAppClient(app: App, client: AppClient, options: ControllerOptions = {}) { const value = createAppControllers(client, options); app.provide(appClientKey, value); return value; }
export function useAppClient() { const value = inject(appClientKey); if (!value) throw new Error('AppClient missing'); return value; }
