<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { enterPage } from '../../shared/navigation';

import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
import { reactive, ref, watch } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { copy } from '../../shared/copy';
import { useAppClient } from '../../shared/app-client';
import { createRouteGuard } from '../../shared/route-guard';
import { normalizeFamilyName } from '../../features/family/validation';
import { errorCode } from '../../shared/errors';
const { rootFontSize } = usePageTypography();
const { auth, family, membership } = useAppClient();
const { phase } = auth;
const { phase: familyPhase, pending, view } = family;
async function openJoin() { if (await leave.confirm()) uni.navigateTo({ url: '/pages/family/join', success: () => { name.value = ''; fields.errors = {}; fields.focused = ''; }, fail: leave.sync }); }
const confirmed = ref(false); const name = ref(''); const message = ref('');
const submitting = ref(false);
let generation = 0; let active = false;
let logoutAttempt: Promise<void> | null = null;
let lastUid = auth.identity.value?.uid;
const fields = reactive(useFieldIssues()); const form = ref<FormInstance>();
const dirty = () => !!name.value && !pending.value && !submitting.value;
const leave = useLeaveGuard(dirty, () => active && (auth.phase.value === 'unavailable' || auth.identity.value?.uid === lastUid), () => (lastUid ?? '') + ':' + (view.value?.generation ?? ''));
function issues() { try { normalizeFamilyName(pending.value?.name ?? name.value); return []; } catch { return [{ path: ['name'], message: copy.invalidFamilyName }]; } }
const schema: FormSchema = { validate: issues };
async function validate() { const uid = auth.identity.value?.uid; await form.value?.validate('name'); if (active && uid === auth.identity.value?.uid && auth.phase.value === 'authenticated') fields.set(issues(), () => 'family-name'); }
function changed() { fields.clear('family-name'); form.value?.reset(); }
function resetLocal() { confirmed.value = false; name.value = ''; message.value = ''; submitting.value = false; fields.errors = {}; fields.focused = ''; }
watch([auth.phase, () => auth.identity.value?.uid], ([phase, uid]) => {
  if (phase === 'anonymous' || phase === 'signing-out') resetLocal();
  else if (uid && uid !== lastUid) { lastUid = uid; resetLocal(); }
}, { flush: 'sync' });
watch([family.phase, family.view], ([phase, view]) => { if (phase === 'ready' && view) { name.value = ''; fields.errors = {}; } }, { flush: 'sync' });
async function check() {
  const current = ++generation; active = true; confirmed.value = false; message.value = ''; submitting.value = false;
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
  message.value = '';
  let normalized: string;
  try { normalized = normalizeFamilyName(pending.value?.name ?? name.value); } catch { await validate(); if (!active || current !== generation || auth.identity.value?.uid !== uid) return; await fields.reveal(); return; }
  submitting.value = true;
  try {
    await form.value?.validate();
    if (!active || current !== generation || auth.identity.value?.uid !== uid) return;
    await (pending.value ? family.retry() : family.submit(normalized));
    if (active && current === generation && auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) { name.value = ''; leave.disable(); uni.switchTab({ url: '/pages/recipes/index' }); }
  } catch (error) {
    if (!active || current !== generation) return;
    const code = errorCode(error);
    if (code === 'AUTH_REQUIRED') {
      if (uid === lastUid && auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
    } else if (auth.phase.value === 'authenticated' && auth.identity.value?.uid === uid) {
      if (code === 'INVALID_INPUT' && pending.value) message.value = copy.pendingFamily;
      else if (code === 'INVALID_INPUT') { fields.errors['family-name'] = copy.familyErrors[code]; await fields.reveal('family-name'); }
      else if (code === 'UNAVAILABLE' && !pending.value) message.value = copy.familyPreparationUnavailable;
      else message.value = copy.familyErrors[code];
    }
  }
  finally { if (current === generation) submitting.value = false; }
}
async function signOut() {
  if (dirty() && !await leave.confirm()) return;
  const current = ++generation; const uid = lastUid; resetLocal();
  const attempt = logoutAttempt = auth.signOut();
  try { await attempt; } catch { /* Local logout remains final. */ }
  finally { if (logoutAttempt === attempt) logoutAttempt = null; }
  if (active && current === generation && uid === lastUid && auth.phase.value === 'anonymous') uni.reLaunch({ url: '/pages/account/login' });
}
function conceal() { const wasActive = active; generation++; active = false; confirmed.value = false; message.value = ''; submitting.value = false; if (wasActive) membership.conceal(); }
onShow(check); onHide(conceal); onUnload(() => { conceal(); resetLocal(); });
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page family-page">
    <view
      v-if="confirmed && phase === 'authenticated' && !view"
      data-protected
    >
      <text class="eyebrow">
        开始记录家里的味道
      </text>
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
        {{ copy.welcome }}
      </text>
      <text>{{ copy.onboarding }}</text>
      <wd-form
        ref="form"
        :model="{ name }"
        :schema="schema"
        error-type="none"
        :disabled="submitting || !!pending"
        :reset-on-change="false"
        data-family-form
      >
        <wd-form-item
          prop="name"
          layout="vertical"
          custom-class="home-form-item"
        >
          <text class="field-label">
            {{ copy.familyName }}
          </text>
          <input
            id="family-name"
            class="home-input"
            :aria-label="copy.familyName"
            :aria-invalid="!!fields.errors['family-name']"
            :aria-describedby="fields.errors['family-name'] ? 'family-name-error' : undefined"
            :focus="fields.focused === 'family-name'"
            placeholder-style="color: var(--home-muted); opacity: 1"
            :cursor-spacing="32"
            :value="pending?.name ?? name"
            :maxlength="80"
            :disabled="submitting || !!pending"
            :placeholder="copy.familyNamePlaceholder"
            @input="name = $event.detail.value; changed()"
            @blur="validate"
          >
          <text
            v-if="fields.errors['family-name']"
            id="family-name-error"
            class="field-error"
            role="alert"
            aria-role="alert"
          >
            {{ fields.errors['family-name'] }}
          </text>
        </wd-form-item>
        <text
          v-if="pending"
          role="status"
          aria-role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ copy.pendingFamily }}
        </text>
        <HomeAction
          v-if="pending"
          :label="copy.resumeFamily"
          type="primary"
          data-resume
          :disabled="submitting"
          :loading="submitting"
          @click="submit"
        >
          {{ copy.resumeFamily }}
        </HomeAction>
        <HomeAction
          v-else
          :label="copy.createFamily"
          type="primary"
          data-create
          :disabled="submitting"
          :loading="submitting"
          @click="submit"
        >
          {{ copy.createFamily }}
        </HomeAction>
      </wd-form>
      <HomeAction
        :label="copy.joinFamily"
        type="info"
        variant="plain"
        data-open-join
        :disabled="submitting || !!pending"
        @click="openJoin"
      >
        {{ copy.joinFamily }}
      </HomeAction>
      <text
        v-if="message"
        role="alert"
        aria-role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {{ message }}
      </text>
      <HomeAction
        v-if="pending && !submitting"
        :label="copy.retry"
        type="info"
        variant="text"
        data-retry
        @click="check"
      >
        {{ copy.retry }}
      </HomeAction>
      <HomeAction
        :label="copy.signOut"
        type="info"
        variant="text"
        data-sign-out
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
        variant="text"
        data-retry
        @click="check"
      >
        {{ copy.retry }}
      </HomeAction>
      <HomeAction
        v-if="phase === 'authenticated' || phase === 'unavailable'"
        :label="copy.signOut"
        type="info"
        variant="text"
        data-sign-out
        @click="signOut"
      >
        {{ copy.signOut }}
      </HomeAction>
    </view>
  </view>
</template>
