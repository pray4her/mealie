<script setup lang="ts">
import { enterPage } from '../../shared/navigation';

import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { copy } from '../../shared/copy';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
const { auth, family, membership } = useAppClient();
const { phase } = auth; const { view } = family;
const { phase: familyPhase } = family;
const openInvite = () => uni.navigateTo({ url: '/pages/family/invite' });
const openMembers = () => uni.navigateTo({ url: '/pages/family/members' });
const openRecipes = () => uni.switchTab({ url: '/pages/recipes/index' });
const confirmed = ref(false);
let generation = 0; let active = false;
let logoutAttempt: Promise<void> | null = null;
let lastUid = auth.identity.value?.uid;
watch([auth.phase, () => auth.identity.value?.uid], ([phase, uid]) => {
  if (phase !== 'authenticated') confirmed.value = false;
  else if (uid && uid !== lastUid) { lastUid = uid; confirmed.value = false; }
}, { flush: 'sync' });
async function check() {
  const current = ++generation; active = true; confirmed.value = false;
  const uid = lastUid;
  if (logoutAttempt) {
    await logoutAttempt.catch(() => {});
    if (!active || current !== generation || uid !== lastUid) return;
    if (auth.phase.value === 'anonymous') { uni.reLaunch({ url: '/pages/account/login' }); return; }
  }
  const guard = createRouteGuard(auth, url => { if (active && current === generation) enterPage(url); }, family, membership, () => active && current === generation);
  const allowed = await guard.ensureFamily('home');
  if (active && current === generation) confirmed.value = allowed;
}
async function signOut() {
  const current = ++generation; const uid = lastUid; confirmed.value = false;
  const attempt = logoutAttempt = auth.signOut();
  try { await attempt; } catch { /* Local logout remains final. */ }
  finally { if (logoutAttempt === attempt) logoutAttempt = null; }
  if (active && current === generation && uid === lastUid && auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
}
function conceal() { const wasActive = active; generation++; active = false; confirmed.value = false; if (wasActive) membership.conceal(); }
onShow(check); onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="page family-page">
    <view
      v-if="confirmed && phase === 'authenticated' && view"
      data-protected
    >
      <text class="eyebrow">
        我们的家庭
      </text>
      <text class="title">
        {{ view.name }}
      </text>
      <text class="role-label">
        {{ view.role === 'owner' ? copy.owner : copy.member }}
      </text>
      <wd-button
        type="info"
        data-recipes
        @click="openRecipes"
      >
        {{ copy.recipes }}
      </wd-button>
      <wd-button
        v-if="view.role === 'owner'"
        type="info"
        data-invite
        @click="openInvite"
      >
        {{ copy.inviteMembers }}
      </wd-button>
      <wd-button
        type="info"
        data-members
        @click="openMembers"
      >
        {{ copy.familyMembers }}
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
