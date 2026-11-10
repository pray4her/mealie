<script setup lang="ts">
import { enterPage } from '../../shared/navigation';

import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { copy } from '../../shared/copy';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
import { normalizeFamilyName } from '../../features/family/validation';
import { errorCode } from '../../shared/errors';
const { auth, family, membership } = useAppClient();
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
  const guard = createRouteGuard(auth, url => { if (active && current === generation) enterPage(url); }, family, membership, () => active && current === generation);
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
    if (active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) uni.switchTab({ url: '/pages/recipes/index' });
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
function conceal() { const wasActive = active; generation++; active = false; resetLocal(); if (wasActive) membership.conceal(); }
onShow(check); onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="page family-page">
    <view
      v-if="confirmed && phase === 'authenticated' && !view"
      data-protected
    >
      <text class="eyebrow">
        开始记录家里的味道
      </text>
      <text class="title">
        {{ copy.welcome }}
      </text>
      <text>{{ copy.onboarding }}</text>
      <wd-button
        type="info"
        data-open-join
        @click="openJoin"
      >
        {{ copy.joinFamily }}
      </wd-button>
      <view data-family-form>
        <text>{{ copy.familyName }}</text>
        <wd-input
          :cursor-spacing="32"
          :model-value="pending?.name ?? name"
          :maxlength="80"
          :disabled="submitting || !!pending"
          :placeholder="copy.familyNamePlaceholder"
          @update:model-value="name = $event"
        />
        <text
          v-if="pending"
          role="status"
        >
          {{ copy.pendingFamily }}
        </text>
        <wd-button
          v-if="pending"
          type="primary"
          data-resume
          :disabled="submitting"
          :aria-disabled="submitting"
          :loading="submitting"
          :aria-busy="submitting"
          @click="submit"
        >
          {{ copy.resumeFamily }}
        </wd-button>
        <wd-button
          v-else
          type="primary"
          data-create
          :disabled="submitting"
          :aria-disabled="submitting"
          :loading="submitting"
          :aria-busy="submitting"
          @click="submit"
        >
          {{ copy.createFamily }}
        </wd-button>
      </view>
      <text
        v-if="message"
        role="alert"
      >
        {{ message }}
      </text>
      <wd-button
        v-if="pending && !submitting"
        type="info"
        data-retry
        @click="check"
      >
        {{ copy.retry }}
      </wd-button>
      <wd-button
        type="info"
        data-sign-out
        @click="signOut"
      >
        {{ copy.signOut }}
      </wd-button>
    </view>
    <view v-else>
      <text role="status">
        {{ phase === 'unavailable' ? copy.unavailable : familyPhase === 'unavailable' ? copy.familyUnavailable : phase === 'signing-out' ? copy.waiting : copy.checking }}
      </text>
      <wd-button
        v-if="phase === 'unavailable' || familyPhase === 'unavailable'"
        type="info"
        data-retry
        @click="check"
      >
        {{ copy.retry }}
      </wd-button>
      <wd-button
        v-if="phase === 'authenticated' || phase === 'unavailable'"
        type="info"
        data-sign-out
        @click="signOut"
      >
        {{ copy.signOut }}
      </wd-button>
    </view>
  </view>
</template>
