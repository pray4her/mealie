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
    return '/pages/family/home';
  });
}
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ copy.joinFamily }}
      </text>
      <view v-if="view">
        <text>{{ copy.alreadyHasFamily }}{{ view.name }}</text>
        <button
          data-home
          @tap="backHome"
        >
          {{ copy.backHome }}
        </button>
      </view>
      <view v-else>
        <text>{{ copy.confirmJoinExplanation }}</text>
        <text v-if="token">
          {{ copy.invitationReceived }}
        </text>
        <view v-else>
          <text>{{ copy.invitationCode }}</text>
          <input
            :value="manual"
            :maxlength="160"
            :disabled="busy"
            :placeholder="copy.invitationPlaceholder"
            @input="manual = $event.detail.value"
          >
        </view>
        <text
          v-if="pendingJoin"
          role="status"
        >
          {{ copy.pendingJoin }}
        </text>
        <button
          data-confirm-join
          :disabled="busy"
          :loading="busy"
          @tap="join"
        >
          {{ pendingJoin ? copy.resumeJoin : copy.confirmJoin }}
        </button>
        <button
          data-back-onboarding
          @tap="backOnboarding"
        >
          {{ copy.backOnboarding }}
        </button>
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
    <button
      v-if="!confirmed"
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
</template>
<style scoped>
.page { padding: 48rpx; }
.title { display: block; margin-bottom: 24rpx; font-size: 40rpx; }
text { display: block; margin-bottom: 24rpx; }
input { padding: 24rpx; background: white; }
button { margin-top: 32rpx; }
</style>
