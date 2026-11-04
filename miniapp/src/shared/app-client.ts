import { inject } from 'vue';
import type { App, InjectionKey } from 'vue';
import type { AppClient } from 'home-contracts';
import { createAuthController } from '../features/auth/use-auth';
import type { AuthController } from '../features/auth/use-auth';
export const appClientKey: InjectionKey<{ client: AppClient; auth: AuthController }> = Symbol('home-app-client');
export function provideAppClient(app: App, client: AppClient) { const value = { client, auth: createAuthController(client.account) }; app.provide(appClientKey, value); return value; }
export function useAppClient() { const value = inject(appClientKey); if (!value) throw new Error('AppClient missing'); return value; }
