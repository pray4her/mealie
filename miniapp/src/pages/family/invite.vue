<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { onShareAppMessage } from '@dcloudio/uni-app';
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
const { rootFontSize } = usePageTypography();
const { invitations, confirmed, busy, message, check, act, signOut, backHome } = useFamilyPage('invite');
const { invitation, items, nextCursor } = invitations;
const formatDate = (value: number) => new Date(value).toLocaleString();
async function generate() { await act(async () => { await invitations.generate(); await invitations.list(); }); }
async function revoke(id: string) {
  await act(async isCurrent => {
    const item = items.value.find(value => value.invitationId === id);
    const result = await uni.showModal({ title: '撤销这条邀请？', content: `创建于 ${item ? formatDate(item.createdAt) : '未知时间'}。撤销后，家人将无法再使用这条邀请加入家庭。`, confirmText: '撤销邀请', confirmColor: '#b33f38', cancelText: copy.cancel });
    if (!result.confirm || !isCurrent()) return;
    await invitations.revoke(id); if (isCurrent()) await invitations.list();
  });
}
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
        {{ copy.inviteMembers }}
      </text>
      <text class="muted">
        {{ copy.invitationExplanation }}
      </text>
      <HomeAction
        :label="copy.generateInvitation"
        :type="invitation ? 'info' : 'primary'"
        :variant="invitation ? 'text' : 'base'"
        data-generate
        :disabled="busy"
        :loading="busy"
        @click="generate"
      >
        {{ copy.generateInvitation }}
      </HomeAction>
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
        <HomeAction
          :label="copy.copyInvitation"
          type="info"
          data-copy
          :disabled="busy"
          @click="copyToken"
        >
          {{ copy.copyInvitation }}
        </HomeAction>
      </view>
      <text class="section">
        邀请记录
      </text>
      <view
        v-for="item in items"
        :key="item.invitationId"
        class="invitation"
        data-invitation
      >
        <text>{{ copy.invitationStatuses[item.status] }} · {{ formatDate(item.createdAt) }}</text>
        <text>{{ copy.expiresAt }}{{ formatDate(item.expiresAt) }}</text>
        <HomeAction
          v-if="item.status === 'pending'"
          :label="copy.revokeInvitation + '，创建于' + formatDate(item.createdAt)"
          type="danger"
          variant="text"
          data-revoke
          :disabled="busy"
          @click="revoke(item.invitationId)"
        >
          {{ copy.revokeInvitation }}
        </HomeAction>
      </view>
      <text v-if="!items.length">
        {{ copy.noInvitations }}
      </text>
      <HomeAction
        v-if="nextCursor"
        :label="copy.loadMore"
        type="info"
        data-more
        :disabled="busy"
        @click="act(() => invitations.list(true))"
      >
        {{ copy.loadMore }}
      </HomeAction>
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
