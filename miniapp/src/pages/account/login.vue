<script setup lang="ts">
import { copy } from '../../shared/copy';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { ref } from 'vue';
import type { Identity } from 'home-contracts';
const { auth } = useAppClient();
const { phase } = auth;
let active = false; let generation = 0;
let signInAttempt: Promise<Identity> | null = null;
const failed = ref(false);
function finishSignIn(current: number, uid: string) {
  if (active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) uni.reLaunch({ url: '/pages/family/onboarding' });
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
  } else if (await auth.restore() && active && current === generation) uni.reLaunch({ url: '/pages/family/onboarding' });
});
function conceal() { active = false; generation++; failed.value = false; }
onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="page">
    <text class="title">
      {{ copy.title }}
    </text>
    <text
      v-if="phase === 'unavailable'"
      role="status"
    >
      {{ copy.unavailable }}
    </text>
    <text v-if="failed && phase === 'anonymous'">
      {{ copy.denied }}
    </text>
    <text
      v-if="phase === 'checking' || phase === 'authenticating'"
      role="status"
    >
      {{ copy.checking }}
    </text>
    <text v-if="phase === 'signing-out'">
      {{ copy.waiting }}
    </text>
    <button
      data-sign-in
      :loading="phase === 'authenticating'"
      :disabled="phase === 'authenticating' || phase === 'checking' || phase === 'signing-out'"
      @tap="signIn"
    >
      {{ failed || phase === 'unavailable' ? copy.retrySignIn : copy.signIn }}
    </button>
  </view>
</template>
<style scoped>
.page { padding: 48rpx; display: flex; flex-direction: column; gap: 32rpx; }
.title { font-size: 44rpx; font-weight: 600; }
</style>
