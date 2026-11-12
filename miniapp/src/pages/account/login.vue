<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import HomeBrand from '../../components/HomeBrand.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { copy } from '../../shared/copy';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useAppClient } from '../../shared/app-client';
import { ref } from 'vue';
import type { Identity } from 'home-contracts';
import { enterPage } from '../../shared/navigation';
const { rootFontSize } = usePageTypography();
const { auth, invitations, family, membership } = useAppClient();
const { phase } = auth;
let active = false; let generation = 0;
let signInAttempt: Promise<Identity> | null = null;
const failed = ref(false);
const resolvingFamily = ref(false); let familyAttempt: Promise<void> | null = null;
function finishSignIn(current: number, uid: string): Promise<void> {
  const valid = () => active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid;
  if (!valid()) return Promise.resolve();
  if (familyAttempt) return familyAttempt;
  resolvingFamily.value = true;
  const attempt = (async () => {
    if (invitations.hasLoginContinuation()) { enterPage('/pages/family/join'); return; }
    await family.load();
    if (!valid()) return;
    if (await membership.resume()) await family.load();
    if (!valid()) return;
    if (family.phase.value !== 'ready') { failed.value = true; return; }
    enterPage(family.view.value ? '/pages/recipes/index' : '/pages/family/onboarding');
  })().finally(() => { if (familyAttempt === attempt) { familyAttempt = null; resolvingFamily.value = false; } });
  familyAttempt = attempt; return attempt;
}
async function signIn() {
  const current = generation;
  failed.value = false;
  const attempt = signInAttempt = auth.signIn();
  try { const identity = await attempt; await finishSignIn(current, identity.uid); }
  catch { if (active && current === generation) failed.value = true; }
  finally { if (signInAttempt === attempt) signInAttempt = null; }
}
async function retry() {
  if (!active || resolvingFamily.value || signInAttempt) return;
  if (phase.value !== 'authenticated' || !auth.identity.value) { await signIn(); return; }
  const current = generation;
  failed.value = false;
  try { await finishSignIn(current, auth.identity.value.uid); }
  catch { if (active && current === generation) failed.value = true; }
}
onShow(async () => {
  const current = ++generation; active = true; failed.value = false;
  if (signInAttempt) {
    try { const identity = await signInAttempt; await finishSignIn(current, identity.uid); }
    catch { if (active && current === generation) failed.value = true; }
  } else if (await auth.restore() && active && current === generation && auth.identity.value) await finishSignIn(current, auth.identity.value.uid).catch(() => { if (active && current === generation) failed.value = true; });
});
function conceal() { active = false; generation++; failed.value = false; familyAttempt = null; resolvingFamily.value = false; }
onHide(conceal); onUnload(conceal);
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page login-page">
    <HomeBrand />
    <text
      class="title"
      role="heading"
      aria-role="heading"
      aria-level="1"
    >
      {{ copy.title }}
    </text>
    <text
      v-if="phase === 'unavailable'"
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
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
      aria-role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      {{ phase === 'authenticated' ? copy.familyUnavailable : copy.denied }}
    </text>
    <text
      v-if="phase === 'checking' || phase === 'authenticating'"
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ copy.checking }}
    </text>
    <text v-if="phase === 'signing-out'">
      {{ copy.waiting }}
    </text>
    <HomeAction
      :label="failed && phase === 'authenticated' ? '重新读取家庭' : failed || phase === 'unavailable' ? copy.retrySignIn : copy.signIn"
      type="primary"
      data-sign-in
      :loading="phase === 'authenticating' || resolvingFamily"
      :disabled="phase === 'authenticating' || phase === 'checking' || phase === 'signing-out' || resolvingFamily"
      @click="retry"
    >
      {{ failed && phase === 'authenticated' ? '重新读取家庭' : failed || phase === 'unavailable' ? copy.retrySignIn : copy.signIn }}
    </HomeAction>
  </view>
</template>
