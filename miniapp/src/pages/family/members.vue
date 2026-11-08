<script setup lang="ts">
import { useFamilyPage } from '../../features/family/use-family-page';
import { copy } from '../../shared/copy';
const { invitations, auth, confirmed, message, check, signOut, backHome } = useFamilyPage('members');
const { members } = invitations;
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed"
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
      </view>
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
.member { padding: 24rpx; margin-bottom: 24rpx; background: white; border-radius: 16rpx; }
text { display: block; margin-bottom: 16rpx; }
button { margin-top: 32rpx; }
</style>
