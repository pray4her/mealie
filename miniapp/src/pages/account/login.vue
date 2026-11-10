<script setup lang="ts">
import { copy } from '../../shared/copy';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { ref } from 'vue';
import type { Identity } from 'home-contracts';
import { enterPage } from '../../shared/navigation';
const { auth, invitations, family, membership } = useAppClient();
const { phase } = auth;
let active = false; let generation = 0;
let signInAttempt: Promise<Identity> | null = null;
const failed = ref(false);
async function finishSignIn(current: number, uid: string) {
  const valid = () => active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid;
  if (!valid()) return;
  if (invitations.hasLoginContinuation()) { enterPage('/pages/family/join'); return; }
  await family.load();
  if (!valid()) return;
  if (await membership.resume()) await family.load();
  if (!valid()) return;
  if (family.phase.value !== 'ready') { failed.value = true; return; }
  enterPage(family.view.value ? '/pages/recipes/index' : '/pages/family/onboarding');
}
async function signIn() {
  const current = generation;
  failed.value = false;
  const attempt = signInAttempt = auth.signIn();
  try { const identity = await attempt; await finishSignIn(current, identity.uid); }
  catch { if (active && current === generation) failed.value = true; }
  finally { if (signInAttempt === attempt) signInAttempt = null; }
}
onShow(async () => {
  const current = ++generation; active = true; failed.value = false;
  if (signInAttempt) {
    try { const identity = await signInAttempt; await finishSignIn(current, identity.uid); }
    catch { if (active && current === generation) failed.value = true; }
  } else if (await auth.restore() && active && current === generation && auth.identity.value) await finishSignIn(current, auth.identity.value.uid).catch(() => { if (active && current === generation) failed.value = true; });
});
function conceal() { active = false; generation++; failed.value = false; }
onHide(conceal); onUnload(conceal);
</script>
<template>
  <view class="page login-page">
    <text class="eyebrow">
      家常 · 家庭厨房
    </text>
    <text class="title">
      {{ copy.title }}
    </text>
    <text
      v-if="phase === 'unavailable'"
      role="status"
    >
      {{ copy.unavailable }}
    </text>
    <text class="muted">
      和家人一起，记下每一道家常菜。
    </text>
    <text
      v-if="failed"
      class="error"
      role="alert"
    >
      {{ phase === 'authenticated' ? copy.familyUnavailable : copy.denied }}
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
    <wd-button
      type="primary"
      data-sign-in
      :loading="phase === 'authenticating'"
      :aria-busy="phase === 'authenticating'"
      :disabled="phase === 'authenticating' || phase === 'checking' || phase === 'signing-out'"
      :aria-disabled="phase === 'authenticating' || phase === 'checking' || phase === 'signing-out'"
      @click="signIn"
    >
      {{ failed || phase === 'unavailable' ? copy.retrySignIn : copy.signIn }}
    </wd-button>
  </view>
</template>
