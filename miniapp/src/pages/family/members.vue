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
  <view class="page family-page">
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
          <wd-button
            type="info"
            data-remove-member
            :disabled="busy"
            :aria-disabled="busy"
            @click="change('removeMember', member)"
          >
            {{ copy.removeMember }}
          </wd-button>
          <wd-button
            type="info"
            data-transfer-owner
            :disabled="busy"
            :aria-disabled="busy"
            @click="change('transferOwner', member)"
          >
            {{ copy.transferOwner }}
          </wd-button>
        </template>
      </view>
      <text
        v-if="view.role === 'owner'"
        data-owner-leave-hint
      >
        {{ copy.ownerLeaveHint }}
      </text>
      <wd-button
        v-else
        type="info"
        data-leave-family
        :disabled="busy"
        :aria-disabled="busy"
        :loading="busy"
        :aria-busy="busy"
        @click="change('leave')"
      >
        {{ copy.leaveFamily }}
      </wd-button>
      <text
        v-if="message"
        role="status"
      >
        {{ message }}
      </text>
      <wd-button
        type="info"
        @click="backHome"
      >
        {{ copy.backHome }}
      </wd-button>
    </view>
    <text
      v-else
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <wd-button
      v-if="!confirmed || !view"
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
