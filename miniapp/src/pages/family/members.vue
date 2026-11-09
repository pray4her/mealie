<script setup lang="ts">
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
import type { MemberView } from 'home-contracts';
import type { MembershipAction } from '../../features/family/membership-validation';
const { invitations, auth, family, membership, confirmed, busy, message, check, act, signOut, backHome } = useFamilyPage('members');
const { members } = invitations;
const { view } = family;
async function change(action: MembershipAction, target?: MemberView) {
  const original = view.value;
  await act(async isCurrent => {
    const result = await uni.showModal({
      title: action === 'leave' ? copy.leaveFamily : action === 'removeMember' ? copy.removeMember : copy.transferOwner,
      content: action === 'leave' ? copy.leaveExplanation : `${target!.nickname}（${copy.memberId}${target!.uid}）\n${action === 'removeMember' ? copy.removeExplanation : copy.transferExplanation}`,
      confirmText: action === 'leave' ? copy.confirmLeave : action === 'removeMember' ? copy.confirmRemove : copy.confirmTransfer,
      cancelText: copy.cancel,
    });
    if (!result.confirm || !isCurrent() || view.value?.familyId !== original?.familyId || view.value?.generation !== original?.generation) return;
    await membership.run(action, target);
    if (isCurrent()) await check();
  });
}
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed && view"
      data-protected
    >
      <text class="title">
        {{ copy.familyMembers }}
      </text>
      <view
        v-for="member in members"
        :key="member.uid"
        class="member"
        data-member
      >
        <text>{{ member.nickname }}{{ member.uid === auth.identity.value?.uid ? copy.me : '' }}</text>
        <text>{{ member.role === 'owner' ? copy.owner : copy.member }}</text>
        <text class="member-id">
          {{ copy.memberId }}{{ member.uid }}
        </text>
        <template v-if="view.role === 'owner' && member.role === 'member' && member.uid !== auth.identity.value?.uid">
          <button
            data-remove-member
            :disabled="busy"
            @tap="change('removeMember', member)"
          >
            {{ copy.removeMember }}
          </button>
          <button
            data-transfer-owner
            :disabled="busy"
            @tap="change('transferOwner', member)"
          >
            {{ copy.transferOwner }}
          </button>
        </template>
      </view>
      <text
        v-if="view.role === 'owner'"
        data-owner-leave-hint
      >
        {{ copy.ownerLeaveHint }}
      </text>
      <button
        v-else
        data-leave-family
        :disabled="busy"
        :loading="busy"
        @tap="change('leave')"
      >
        {{ copy.leaveFamily }}
      </button>
      <text
        v-if="message"
        role="status"
      >
        {{ message }}
      </text>
      <button @tap="backHome">
        {{ copy.backHome }}
      </button>
    </view>
    <text
      v-else
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <button
      v-if="!confirmed || !view"
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
.member { padding: 24rpx; margin-bottom: 24rpx; background: white; border-radius: 16rpx; }
.member-id { overflow-wrap: anywhere; }
text { display: block; margin-bottom: 16rpx; }
button { margin-top: 32rpx; }
</style>
