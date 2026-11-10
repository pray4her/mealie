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
  <view class="page family-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ copy.inviteMembers }}
      </text>
      <text>{{ copy.invitationExplanation }}</text>
      <wd-button
        type="primary"
        data-generate
        :disabled="busy"
        :aria-disabled="busy"
        :loading="busy"
        :aria-busy="busy"
        @click="generate"
      >
        {{ copy.generateInvitation }}
      </wd-button>
      <view
        v-if="invitation"
        class="invitation"
      >
        <text>{{ copy.expiresAt }}{{ formatDate(invitation.expiresAt) }}</text>
        <button
          class="native-share"
          data-share
          open-type="share"
          :disabled="busy"
        >
          {{ copy.shareInvitation }}
        </button>
        <wd-button
          type="info"
          data-copy
          :disabled="busy"
          :aria-disabled="busy"
          @click="copyToken"
        >
          {{ copy.copyInvitation }}
        </wd-button>
      </view>
      <view
        v-for="item in items"
        :key="item.invitationId"
        class="invitation"
        data-invitation
      >
        <text>{{ copy.invitationStatuses[item.status] }} · {{ formatDate(item.createdAt) }}</text>
        <text>{{ copy.expiresAt }}{{ formatDate(item.expiresAt) }}</text>
        <wd-button
          v-if="item.status === 'pending'"
          type="info"
          data-revoke
          :disabled="busy"
          :aria-disabled="busy"
          @click="revoke(item.invitationId)"
        >
          {{ copy.revokeInvitation }}
        </wd-button>
      </view>
      <text v-if="!items.length">
        {{ copy.noInvitations }}
      </text>
      <wd-button
        v-if="nextCursor"
        type="info"
        data-more
        :disabled="busy"
        :aria-disabled="busy"
        @click="act(() => invitations.list(true))"
      >
        {{ copy.loadMore }}
      </wd-button>
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
