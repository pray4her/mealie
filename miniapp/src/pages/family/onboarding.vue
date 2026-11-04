<script setup lang="ts">
import { copy } from '../../shared/copy';
import { ref } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
const { auth } = useAppClient(); const { phase } = auth; const confirmed = ref(false);
let generation = 0; let active = true;
const guard = createRouteGuard(auth, url => { if (active) uni.reLaunch({ url }); });
async function check() { const current = ++generation; active = true; confirmed.value = false; const allowed = await guard.ensureAuthenticated(); if (active && current === generation) confirmed.value = allowed; }
async function signOut() {
  confirmed.value = false;
  try { await auth.signOut(); } catch { /* Local logout is still final; remote revoke is unconfirmed. */ }
  finally { if (active) uni.reLaunch({ url: '/pages/account/login' }); }
}
function conceal() { generation++; active = false; confirmed.value = false; }
onShow(check); onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed && phase === 'authenticated'"
      data-protected
    >
      <text class="title">
        {{ copy.welcome }}
      </text><text>{{ copy.onboarding }}</text>
      <button
        data-sign-out
        @tap="signOut"
      >
        {{ copy.signOut }}
      </button>
    </view>
    <view v-else>
      <text role="status">
        {{ phase === 'unavailable' ? copy.unavailable : phase === 'signing-out' ? copy.waiting : copy.checking }}
      </text>
      <button
        v-if="phase === 'unavailable'"
        @tap="check"
      >
        {{ copy.retry }}
      </button>
    </view>
  </view>
</template>
<style scoped>
.page { padding: 48rpx; }
.title { display: block; margin-bottom: 24rpx; font-size: 40rpx; }
button { margin-top: 40rpx; }
</style>
