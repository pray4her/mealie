<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
import { validInvitationToken } from '../../features/family/invitation-validation';
import { reactive, ref, watch } from 'vue';
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
import { AppError, errorCode } from '../../shared/errors';
const { rootFontSize } = usePageTypography();
const { invitations, family, auth, confirmed, busy, message, check, act, signOut: doSignOut, showError, backHome } = useFamilyPage('join');
const { view } = family; const { token, pendingJoin } = invitations; const manual = ref('');
const fields = reactive(useFieldIssues()); const form = ref<FormInstance>(); let active = false; let lastUid = auth.identity.value?.uid;
const scope = () => { const current = view.value; return (auth.identity.value?.uid ?? '') + ':' + (current ? current.familyId + ':' + current.generation : ''); };
let leaveScope = scope();
const dirty = () => !!manual.value && !token.value && !busy.value;
const leave = useLeaveGuard(dirty, () => active && (auth.phase.value === 'unavailable' || auth.identity.value?.uid === lastUid), () => (auth.identity.value?.uid ?? '') + ':' + leaveScope);
function reset() { manual.value = ''; fields.errors = {}; fields.focused = ''; }
watch([auth.phase, () => auth.identity.value?.uid, family.phase, view], ([phase, uid, familyPhase, current]) => {
  if (phase === 'anonymous' || phase === 'signing-out' || uid && lastUid && uid !== lastUid || familyPhase === 'ready' && current) reset();
  if (familyPhase === 'ready') leaveScope = scope();
  if (uid) lastUid = uid;
}, { flush: 'sync' });
onShow(() => { active = true; }); onHide(() => { active = false; }); onUnload(() => { active = false; reset(); });
function issues() { return token.value || validInvitationToken(manual.value.trim()) ? [] : [{ path: ['manual'], message: copy.invitationErrors.INVITATION_INVALID }]; }
const schema: FormSchema = { validate: issues };
async function validate() { const before = scope(); await form.value?.validate('manual'); if (active && before === scope() && auth.phase.value === 'authenticated') fields.set(issues(), () => 'invitation-code'); }
function changed() { fields.clear('invitation-code'); form.value?.reset(); }
async function backOnboarding() { if (await leave.confirm()) { invitations.clearIncoming(); uni.reLaunch({ url: '/pages/family/onboarding', fail: leave.sync }); } }
async function signOut() { if (!dirty() || await leave.confirm()) await doSignOut(); }
onLoad((query) => {
  if (query?.token !== undefined) {
    try { invitations.receive(query.token); } catch (error) { showError(error); }
  }
});
async function join() {
  await act(async current => {
    await validate(); if (!current()) return;
    if (fields.errors['invitation-code']) { await fields.reveal(); return; }
    if (!token.value) invitations.receive(manual.value.trim());
    let result;
    try { result = await invitations.join(); }
    catch (error) {
      if (current() && pendingJoin.value && errorCode(error) === 'CONFLICT') invitations.clearIncoming();
      if (current() && !token.value && ['INVITATION_INVALID', 'INVALID_INPUT', 'CONFLICT'].includes(errorCode(error))) { fields.errors['invitation-code'] = copy.invitationErrors[errorCode(error)]; await fields.reveal('invitation-code'); }
      throw error;
    }
    await family.load();
    const joined = family.view.value;
    if (!joined || joined.uid !== result.uid || joined.familyId !== result.familyId || joined.generation !== result.generation) throw new AppError('CONFLICT');
    if (!current()) return;
    manual.value = ''; leave.disable(); return '/pages/recipes/index';
  });
}
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page family-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
        {{ copy.joinFamily }}
      </text>
      <view v-if="view">
        <text>{{ copy.alreadyHasFamily }}{{ view.name }}</text>
        <HomeAction
          :label="copy.backHome"
          type="info"
          data-home
          @click="backHome"
        >
          {{ copy.backHome }}
        </HomeAction>
      </view>
      <view v-else>
        <text>{{ copy.confirmJoinExplanation }}</text>
        <text v-if="token">
          {{ copy.invitationReceived }}
        </text>
        <wd-form
          v-else
          ref="form"
          :model="{ manual }"
          :schema="schema"
          error-type="none"
          :disabled="busy"
          :reset-on-change="false"
        >
          <wd-form-item
            prop="manual"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text class="field-label">
              {{ copy.invitationCode }}
            </text>
            <input
              id="invitation-code"
              class="home-input"
              :aria-label="copy.invitationCode"
              :aria-invalid="!!fields.errors['invitation-code']"
              :aria-describedby="fields.errors['invitation-code'] ? 'invitation-code-error' : undefined"
              :focus="fields.focused === 'invitation-code'"
              placeholder-style="color: var(--home-muted); opacity: 1"
              :cursor-spacing="32"
              :value="manual"
              :maxlength="160"
              :disabled="busy"
              :placeholder="copy.invitationPlaceholder"
              @input="manual = $event.detail.value; changed()"
              @blur="validate"
            >
            <text
              v-if="fields.errors['invitation-code']"
              id="invitation-code-error"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors['invitation-code'] }}
            </text>
          </wd-form-item>
        </wd-form>
        <text
          v-if="pendingJoin"
          role="status"
          aria-role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ copy.pendingJoin }}
        </text>
        <HomeAction
          :label="pendingJoin ? copy.resumeJoin : copy.confirmJoin"
          type="primary"
          data-confirm-join
          :disabled="busy"
          :loading="busy"
          @click="join"
        >
          {{ pendingJoin ? copy.resumeJoin : copy.confirmJoin }}
        </HomeAction>
        <HomeAction
          :label="copy.backOnboarding"
          type="info"
          variant="text"
          data-back-onboarding
          @click="backOnboarding"
        >
          {{ copy.backOnboarding }}
        </HomeAction>
      </view>
    </view>
    <text
      v-else
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ message || copy.checking }}
    </text>
    <text
      v-if="confirmed && message"
      role="alert"
      aria-role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      {{ message }}
    </text>
    <HomeAction
      v-if="!confirmed"
      :label="copy.retry"
      type="info"
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
</template>
