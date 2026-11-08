<script setup lang="ts">
import { onShareAppMessage } from '@dcloudio/uni-app';
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
const { invitations, confirmed, busy, message, check, act, signOut, backHome } = useFamilyPage('invite');
const { invitation, items, nextCursor } = invitations;
const formatDate = (value: number) => new Date(value).toLocaleString();
async function generate() { await act(async () => { await invitations.generate(); await invitations.list(); }); }
async function revoke(id: string) { await act(async () => { await invitations.revoke(id); await invitations.list(); }); }
async function copyToken() {
  await act(async () => { if (invitation.value && Date.now() < invitation.value.expiresAt) await uni.setClipboardData({ data: invitation.value.token }); });
}
onShareAppMessage(() => ({
  title: copy.shareInvitation, imageUrl: '/static/family-share.png',
  path: confirmed.value && invitation.value && Date.now() < invitation.value.expiresAt
    ? `/pages/family/join?token=${encodeURIComponent(invitation.value.token)}` : '/pages/account/login',
}));
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ copy.inviteMembers }}
      </text>
      <text>{{ copy.invitationExplanation }}</text>
      <button
        data-generate
        :disabled="busy"
        :loading="busy"
        @tap="generate"
      >
        {{ copy.generateInvitation }}
      </button>
      <view
        v-if="invitation"
        class="invitation"
      >
        <text>{{ copy.expiresAt }}{{ formatDate(invitation.expiresAt) }}</text>
        <button
          data-share
          open-type="share"
          :disabled="busy"
        >
          {{ copy.shareInvitation }}
        </button>
        <button
          data-copy
          :disabled="busy"
          @tap="copyToken"
        >
          {{ copy.copyInvitation }}
        </button>
      </view>
      <view
        v-for="item in items"
        :key="item.invitationId"
        class="invitation"
        data-invitation
      >
        <text>{{ copy.invitationStatuses[item.status] }} · {{ formatDate(item.createdAt) }}</text>
        <text>{{ copy.expiresAt }}{{ formatDate(item.expiresAt) }}</text>
        <button
          v-if="item.status === 'pending'"
          data-revoke
          :disabled="busy"
          @tap="revoke(item.invitationId)"
        >
          {{ copy.revokeInvitation }}
        </button>
      </view>
      <text v-if="!items.length">
        {{ copy.noInvitations }}
      </text>
      <button
        v-if="nextCursor"
        data-more
        :disabled="busy"
        @tap="act(() => invitations.list(true))"
      >
        {{ copy.loadMore }}
      </button>
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
.invitation { margin-top: 32rpx; padding: 24rpx; background: white; border-radius: 16rpx; }
text { display: block; margin-bottom: 16rpx; }
button { margin-top: 24rpx; }
</style>
