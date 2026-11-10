<script setup lang="ts">
import { ref, watch } from 'vue';
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app';
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
import { AppError } from '../../shared/errors';
const { invitations, family, auth, confirmed, busy, message, check, act, signOut, showError, backHome } = useFamilyPage('join');
const { view } = family; const { token, pendingJoin } = invitations; const manual = ref('');
watch([auth.phase, () => auth.identity.value?.uid], () => { manual.value = ''; }, { flush: 'sync' });
onHide(() => { manual.value = ''; }); onUnload(() => { manual.value = ''; });
function backOnboarding() { invitations.clearIncoming(); uni.reLaunch({ url: '/pages/family/onboarding' }); }
onLoad((query) => {
  if (query?.token !== undefined) {
    try { invitations.receive(query.token); } catch (error) { showError(error); }
  }
});
async function join() {
  await act(async () => {
    if (!token.value) invitations.receive(manual.value.trim());
    const result = await invitations.join();
    await family.load();
    const current = family.view.value;
    if (!current || current.uid !== result.uid || current.familyId !== result.familyId || current.generation !== result.generation) throw new AppError('CONFLICT');
    return '/pages/recipes/index';
  });
}
</script>
<template>
  <view class="page family-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ copy.joinFamily }}
      </text>
      <view v-if="view">
        <text>{{ copy.alreadyHasFamily }}{{ view.name }}</text>
        <wd-button
          type="info"
          data-home
          @click="backHome"
        >
          {{ copy.backHome }}
        </wd-button>
      </view>
      <view v-else>
        <text>{{ copy.confirmJoinExplanation }}</text>
        <text v-if="token">
          {{ copy.invitationReceived }}
        </text>
        <view v-else>
          <text>{{ copy.invitationCode }}</text>
          <wd-input
            :cursor-spacing="32"
            :model-value="manual"
            :maxlength="160"
            :disabled="busy"
            :placeholder="copy.invitationPlaceholder"
            @update:model-value="manual = $event"
          />
        </view>
        <text
          v-if="pendingJoin"
          role="status"
        >
          {{ copy.pendingJoin }}
        </text>
        <wd-button
          type="primary"
          data-confirm-join
          :disabled="busy"
          :aria-disabled="busy"
          :loading="busy"
          :aria-busy="busy"
          @click="join"
        >
          {{ pendingJoin ? copy.resumeJoin : copy.confirmJoin }}
        </wd-button>
        <wd-button
          type="info"
          data-back-onboarding
          @click="backOnboarding"
        >
          {{ copy.backOnboarding }}
        </wd-button>
      </view>
    </view>
    <text
      v-else
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <text
      v-if="confirmed && message"
      role="alert"
    >
      {{ message }}
    </text>
    <wd-button
      v-if="!confirmed"
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
</template>
