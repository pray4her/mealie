<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
import type { MemberView } from 'home-contracts';
import type { MembershipAction } from '../../features/family/membership-validation';
const { rootFontSize } = usePageTypography();
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
  <page-meta :root-font-size="rootFontSize" />
  <view class="page family-page">
    <view
      v-if="confirmed && view"
      data-protected
    >
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
        {{ copy.familyMembers }}
      </text>
      <view
        v-for="member in members"
        :key="member.uid"
        class="member"
        data-member
      >
        <view class="member-heading">
          <text
            class="member-avatar"
            aria-hidden="true"
          >
            {{ member.nickname.slice(0, 1) }}
          </text>
          <view>
            <text class="member-name">
              {{ member.nickname }}{{ member.uid === auth.identity.value?.uid ? copy.me : '' }}
            </text>
            <text class="muted">
              {{ member.role === 'owner' ? copy.owner : copy.member }}
            </text>
          </view>
        </view>
        <text
          class="member-id"
          :aria-label="copy.memberId + member.uid"
        >
          编号尾号 {{ member.uid.slice(-4) }}
        </text>
        <template v-if="view.role === 'owner' && member.role === 'member' && member.uid !== auth.identity.value?.uid">
          <HomeAction
            :label="copy.removeMember + ' ' + member.nickname"
            type="danger"
            variant="text"
            data-remove-member
            :disabled="busy"
            @click="change('removeMember', member)"
          >
            {{ copy.removeMember }}
          </HomeAction>
          <HomeAction
            :label="copy.transferOwner + ' ' + member.nickname"
            type="info"
            variant="text"
            data-transfer-owner
            :disabled="busy"
            @click="change('transferOwner', member)"
          >
            {{ copy.transferOwner }}
          </HomeAction>
        </template>
      </view>
      <text
        v-if="view.role === 'owner'"
        data-owner-leave-hint
      >
        {{ copy.ownerLeaveHint }}
      </text>
      <HomeAction
        v-else
        :label="copy.leaveFamily"
        type="danger"
        variant="plain"
        data-leave-family
        :disabled="busy"
        :loading="busy"
        @click="change('leave')"
      >
        {{ copy.leaveFamily }}
      </HomeAction>
      <text
        v-if="message"
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ message }}
      </text>
      <HomeAction
        :label="copy.backHome"
        type="info"
        variant="text"
        @click="backHome"
      >
        {{ copy.backHome }}
      </HomeAction>
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
    <HomeAction
      v-if="!confirmed || !view"
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
