<script setup lang="ts">
import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { copy } from '../../shared/copy';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
import { normalizeFamilyName } from '../../features/family/validation';
import { errorCode } from '../../shared/errors';
const { auth, family } = useAppClient();
const { phase } = auth;
const { phase: familyPhase, pending, view } = family;
const openJoin = () => uni.navigateTo({ url: '/pages/family/join' });
const confirmed = ref(false); const name = ref(''); const message = ref('');
const submitting = ref(false);
let generation = 0; let active = false;
let logoutAttempt: Promise<void> | null = null;
let lastUid = auth.identity.value?.uid;
function resetLocal() { confirmed.value = false; name.value = ''; message.value = ''; submitting.value = false; }
watch([auth.phase, () => auth.identity.value?.uid], ([phase, uid]) => {
  if (phase !== 'authenticated') resetLocal();
  else if (uid && uid !== lastUid) { lastUid = uid; resetLocal(); }
}, { flush: 'sync' });
async function check() {
  const current = ++generation; active = true; resetLocal();
  const uid = lastUid;
  if (logoutAttempt) {
    await logoutAttempt.catch(() => {});
    if (!active || current !== generation || uid !== lastUid) return;
    if (auth.phase.value === 'anonymous') { uni.reLaunch({ url: '/pages/account/login' }); return; }
  }
  const guard = createRouteGuard(auth, url => { if (active && current === generation) uni.reLaunch({ url }); }, family);
  const allowed = await guard.ensureFamily('onboarding');
  if (active && current === generation) confirmed.value = allowed;
}
async function submit() {
  if (submitting.value || !confirmed.value || view.value) return;
  const current = generation; const uid = auth.identity.value?.uid;
  let normalized: string;
  try { normalized = normalizeFamilyName(pending.value?.name ?? name.value); } catch { message.value = copy.invalidFamilyName; return; }
  message.value = ''; submitting.value = true;
  try {
    await (pending.value ? family.retry() : family.submit(normalized));
    if (active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) uni.reLaunch({ url: '/pages/family/home' });
  } catch (error) {
    if (!active || current !== generation) return;
    const code = errorCode(error);
    if (code === 'AUTH_REQUIRED') {
      if (uid === lastUid && auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
    } else if (auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) {
      if (code === 'INVALID_INPUT' && pending.value) message.value = copy.pendingFamily;
      else if (code === 'UNAVAILABLE' && !pending.value) message.value = copy.familyPreparationUnavailable;
      else message.value = copy.familyErrors[code];
    }
  }
  finally { if (current === generation) submitting.value = false; }
}
async function signOut() {
  const current = ++generation; const uid = lastUid; resetLocal();
  const attempt = logoutAttempt = auth.signOut();
  try { await attempt; } catch { /* Local logout remains final. */ }
  finally { if (logoutAttempt === attempt) logoutAttempt = null; }
  if (active && current === generation && uid === lastUid && auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
}
function conceal() { generation++; active = false; resetLocal(); }
onShow(check); onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed && phase === 'authenticated' && !view"
      data-protected
    >
      <text class="title">
        {{ copy.welcome }}
      </text>
      <text>{{ copy.onboarding }}</text>
      <button
        data-open-join
        @tap="openJoin"
      >
        {{ copy.joinFamily }}
      </button>
      <view data-family-form>
        <text>{{ copy.familyName }}</text>
        <input
          :value="pending?.name ?? name"
          :maxlength="80"
          :disabled="submitting || !!pending"
          :placeholder="copy.familyNamePlaceholder"
          @input="name = $event.detail.value"
        >
        <text
          v-if="pending"
          role="status"
        >
          {{ copy.pendingFamily }}
        </text>
        <button
          v-if="pending"
          data-resume
          :disabled="submitting"
          :loading="submitting"
          @tap="submit"
        >
          {{ copy.resumeFamily }}
        </button>
        <button
          v-else
          data-create
          :disabled="submitting"
          :loading="submitting"
          @tap="submit"
        >
          {{ copy.createFamily }}
        </button>
      </view>
      <text
        v-if="message"
        role="alert"
      >
        {{ message }}
      </text>
      <button
        v-if="pending && !submitting"
        data-retry
        @tap="check"
      >
        {{ copy.retry }}
      </button>
      <button
        data-sign-out
        @tap="signOut"
      >
        {{ copy.signOut }}
      </button>
    </view>
    <view v-else>
      <text role="status">
        {{ phase === 'unavailable' ? copy.unavailable : familyPhase === 'unavailable' ? copy.familyUnavailable : phase === 'signing-out' ? copy.waiting : copy.checking }}
      </text>
      <button
        v-if="phase === 'unavailable' || familyPhase === 'unavailable'"
        data-retry
        @tap="check"
      >
        {{ copy.retry }}
      </button>
      <button
        v-if="phase === 'authenticated' || phase === 'unavailable'"
        data-sign-out
        @tap="signOut"
      >
        {{ copy.signOut }}
      </button>
    </view>
  </view>
</template>
<style scoped>
.page { padding: 48rpx; }
.title { display: block; margin-bottom: 24rpx; font-size: 40rpx; }
input { padding: 24rpx; margin-top: 24rpx; background: white; }
button { margin-top: 40rpx; }
</style>
