import { readonly, ref } from 'vue';
import type { AccountApi, Identity } from 'home-contracts';
import { errorCode } from '../../shared/errors';
import { observeAccountClosure } from './api';
export type AuthPhase = 'anonymous' | 'authenticating' | 'checking' | 'authenticated' | 'signing-out' | 'unavailable';
export function createAuthController(account: AccountApi) {
  const identity = ref<Identity | null>(null); const phase = ref<AuthPhase>('anonymous');
  let generation = 0; let signInAttempt: Promise<Identity> | null = null; let restoreAttempt: Promise<boolean> | null = null;
  let signInGeneration = 0;
  observeAccountClosure(account, closing => {
    if (closing) { generation++; identity.value = null; phase.value = 'signing-out'; }
    else if (phase.value === 'signing-out') phase.value = 'anonymous';
  });
  const controller = {
    identity: readonly(identity), phase: readonly(phase),
    signIn(): Promise<Identity> {
      if (signInAttempt && signInGeneration === generation) return signInAttempt;
      const current = ++generation; identity.value = null; phase.value = 'authenticating';
      signInGeneration = current;
      signInAttempt = (async () => {
        try { const value = await account.signInWeixin(); if (current === generation) { identity.value = value; phase.value = 'authenticated'; } return value; }
        catch (error) { if (current === generation) phase.value = errorCode(error) === 'AUTH_REQUIRED' ? 'anonymous' : 'unavailable'; throw error; }
        finally { if (signInGeneration === current) signInAttempt = null; }
      })();
      return signInAttempt;
    },
    restore(): Promise<boolean> {
      if (restoreAttempt) return restoreAttempt;
      if (phase.value === 'signing-out' || phase.value === 'authenticating') return Promise.resolve(false);
      const current = ++generation; identity.value = null; phase.value = 'checking';
      restoreAttempt = (async () => {
        try { const value = await account.session(); if (current !== generation) return false; identity.value = value; phase.value = 'authenticated'; return true; }
        catch (error) { if (current === generation) phase.value = errorCode(error) === 'AUTH_REQUIRED' ? 'anonymous' : 'unavailable'; return false; }
        finally { restoreAttempt = null; }
      })(); return restoreAttempt;
    },
    async signOut(): Promise<void> {
      generation++; identity.value = null; phase.value = 'signing-out';
      try { await account.signOut(); } finally { identity.value = null; phase.value = 'anonymous'; }
    },
  }; return controller;
}
export type AuthController = ReturnType<typeof createAuthController>;
