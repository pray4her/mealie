<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import HomeBrand from '../../components/HomeBrand.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { enterPage } from '../../shared/navigation';

import { ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { copy } from '../../shared/copy';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
const { rootFontSize } = usePageTypography();
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
  <page-meta :root-font-size="rootFontSize" />
  <view class="page family-page">
    <view
      v-if="confirmed && phase === 'authenticated' && view"
      data-protected
    >
      <HomeBrand />
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
        {{ view.name }}
      </text>
      <text class="role-label">
        {{ view.role === 'owner' ? copy.owner : copy.member }}
      </text>
      <wd-cell-group
        custom-class="family-nav"
        border
      >
        <view
          class="family-nav__action"
          role="button"
          aria-role="button"
          :aria-label="copy.recipes"
          tabindex="0"
          data-recipes
          @click="openRecipes"
          @keydown.enter.prevent="openRecipes"
          @keydown.space.prevent="openRecipes"
        >
          <view aria-hidden="true">
            <wd-cell
              :title="copy.recipes"
              is-link
            />
          </view>
        </view>
        <view
          v-if="view.role === 'owner'"
          class="family-nav__action"
          role="button"
          aria-role="button"
          :aria-label="copy.inviteMembers"
          tabindex="0"
          data-invite
          @click="openInvite"
          @keydown.enter.prevent="openInvite"
          @keydown.space.prevent="openInvite"
        >
          <view aria-hidden="true">
            <wd-cell
              :title="copy.inviteMembers"
              is-link
            />
          </view>
        </view>
        <view
          class="family-nav__action"
          role="button"
          aria-role="button"
          :aria-label="copy.familyMembers"
          tabindex="0"
          data-members
          @click="openMembers"
          @keydown.enter.prevent="openMembers"
          @keydown.space.prevent="openMembers"
        >
          <view aria-hidden="true">
            <wd-cell
              :title="copy.familyMembers"
              is-link
            />
          </view>
        </view>
      </wd-cell-group>
      <HomeAction
        :label="copy.signOut"
        type="info"
        data-sign-out
        variant="text"
        @click="signOut"
      >
        {{ copy.signOut }}
      </HomeAction>
    </view>
    <view v-else>
      <text
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ phase === 'unavailable' ? copy.unavailable : familyPhase === 'unavailable' ? copy.familyUnavailable : phase === 'signing-out' ? copy.waiting : copy.checking }}
      </text>
      <HomeAction
        v-if="phase === 'unavailable' || familyPhase === 'unavailable'"
        :label="copy.retry"
        type="info"
        data-retry
        @click="check"
      >
        {{ copy.retry }}
      </HomeAction>
      <HomeAction
        v-if="phase === 'authenticated' || phase === 'unavailable'"
        :label="copy.signOut"
        type="info"
        data-sign-out
        @click="signOut"
      >
        {{ copy.signOut }}
      </HomeAction>
    </view>
  </view>
</template>
