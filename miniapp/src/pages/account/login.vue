<script setup lang="ts">
import { copy } from '../../shared/copy';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { ref } from 'vue';
import type { Identity } from 'home-contracts';
const { auth, invitations } = useAppClient();
const { phase } = auth;
let active = false; let generation = 0;
let signInAttempt: Promise<Identity> | null = null;
const failed = ref(false);
function finishSignIn(current: number, uid: string) {
  if (active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) uni.reLaunch({ url: invitations.hasLoginContinuation() ? '/pages/family/join' : '/pages/family/onboarding' });
}
async function signIn() {
  const current = generation;
  failed.value = false;
  const attempt = signInAttempt = auth.signIn();
  try { const identity = await attempt; finishSignIn(current, identity.uid); }
  catch { if (active && current === generation) failed.value = true; }
  finally { if (signInAttempt === attempt) signInAttempt = null; }
}
onShow(async () => {
  const current = ++generation; active = true; failed.value = false;
  if (signInAttempt) {
    try { const identity = await signInAttempt; finishSignIn(current, identity.uid); }
    catch { if (active && current === generation) failed.value = true; }
  } else if (await auth.restore() && active && current === generation) uni.reLaunch({ url: invitations.hasLoginContinuation() ? '/pages/family/join' : '/pages/family/onboarding' });
});
function conceal() { active = false; generation++; failed.value = false; }
onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="login-page">
    <view class="login-intro">
      <text class="brand">
        {{ copy.brandName }}
      </text>
      <text
        class="title"
        role="heading"
        aria-level="1"
      >
        {{ copy.loginIntro }}
      </text>
      <text class="description">
        {{ copy.loginHint }}
      </text>
    </view>
    <view class="login-actions">
      <view
        v-if="phase === 'unavailable' || (failed && phase === 'anonymous')"
        class="feedback error"
        role="alert"
        aria-live="assertive"
      >
        <text>{{ phase === 'unavailable' ? copy.unavailable : copy.denied }}</text>
      </view>
      <view
        v-if="phase === 'checking' || phase === 'authenticating' || phase === 'signing-out'"
        class="feedback"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <text>{{ phase === 'authenticating' ? copy.signingIn : phase === 'checking' ? copy.checking : copy.waiting }}</text>
      </view>
      <wd-button
        data-sign-in
        type="primary"
        size="large"
        block
        :loading="phase === 'authenticating'"
        :disabled="phase === 'authenticating' || phase === 'checking' || phase === 'signing-out'"
        @click="signIn"
      >
        {{ failed || phase === 'unavailable' ? copy.retrySignIn : copy.signIn }}
      </wd-button>
    </view>
  </view>
</template>
<style scoped>
.login-page { min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 48px; padding: calc(48px + env(safe-area-inset-top)) 20px calc(32px + env(safe-area-inset-bottom)); background: var(--app-surface); }
.login-intro, .login-actions { display: flex; flex-direction: column; gap: 16px; width: 100%; min-width: 0; }
.brand { color: var(--app-primary); font-size: 18px; font-weight: 600; }
.title { font-size: 24px; font-weight: 600; line-height: 1.5; }
.description, .feedback { font-size: 16px; line-height: 1.75; color: var(--app-text-secondary); overflow-wrap: anywhere; }
.error { color: var(--app-danger); }
@media (max-width: 350px) { .login-page { padding-left: 16px; padding-right: 16px; } }
</style>
