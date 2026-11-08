import { inject } from 'vue';
import type { App, InjectionKey } from 'vue';
import type { AppClient } from 'home-contracts';
import { createAuthController } from '../features/auth/use-auth';
import { createFamilyController } from '../features/family/use-family';
import { createFamilyIntentStore, newRequestId } from '../features/family/intents';
import { createInvitationIntents } from '../features/family/invitation-intents';
import { createInvitationController } from '../features/family/use-invitations';
import type { SessionStorage } from './session-boundary';

type ControllerOptions = { storage?: SessionStorage; newRequestId?: () => Promise<string> };
function createAppControllers(client: AppClient, options: ControllerOptions) {
  const auth = createAuthController(client.account);
  const storage = options.storage ?? {
    get: (key: string) => uni.getStorageSync(key), set: (key: string, value: unknown) => { uni.setStorageSync(key, value); }, remove: (key: string) => { uni.removeStorageSync(key); },
  };
  const creations = createFamilyIntentStore(storage); const invitationIntents = createInvitationIntents(storage);
  const random = options.newRequestId ?? newRequestId;
  const family = createFamilyController({ api: client.family, account: client.account, auth, intents: creations, newRequestId: random, hasPendingJoin: uid => !!invitationIntents.read(uid, 'join') });
  const invitations = createInvitationController({ api: client.family, auth, family, intents: invitationIntents, creations, newRequestId: random });
  return { client, auth, family, invitations };
}
export const appClientKey: InjectionKey<ReturnType<typeof createAppControllers>> = Symbol('home-app-client');
export function provideAppClient(app: App, client: AppClient, options: ControllerOptions = {}) { const value = createAppControllers(client, options); app.provide(appClientKey, value); return value; }
export function useAppClient() { const value = inject(appClientKey); if (!value) throw new Error('AppClient missing'); return value; }
