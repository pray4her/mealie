<script setup lang="ts">
import { copy } from '../../shared/copy';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { ref } from 'vue';
const { auth } = useAppClient();
const { phase } = auth;
let active = true;
const failed = ref(false);
async function signIn() {
  failed.value = false;
  try { await auth.signIn(); if (active && auth.phase.value === 'authenticated') uni.reLaunch({ url: '/pages/family/onboarding' }); }
  catch { failed.value = true; }
}
onShow(async () => { active = true; if (await auth.restore() && active) uni.reLaunch({ url: '/pages/family/onboarding' }); });
onHide(() => { active = false; }); onUnload(() => { active = false; });
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
