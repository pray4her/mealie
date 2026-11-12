<script setup lang="ts">
import HomeAction from './HomeAction.vue';
defineOptions({ options: { virtualHost: true, addGlobalClass: true, styleIsolation: 'shared' } });
defineProps<{ familyName?: string }>();
defineEmits<{ family: [] }>();
</script>
<template>
  <view class="home-brand">
    <view
      class="home-brand__mark"
      aria-label="家常"
    >
      <image
        src="/static/brand-leaf.png"
        class="home-brand__leaf"
        aria-hidden="true"
      />
      <text>家常</text>
    </view>
    <HomeAction
      v-if="familyName"
      :label="familyName + '，进入家庭'"
      custom-class="brand-family"
      type="info"
      variant="text"
      @click="$emit('family')"
    >
      <image
        src="/static/tab-family.png"
        class="home-brand__family-icon"
        aria-hidden="true"
      />
      <text>{{ familyName }}</text>
    </HomeAction>
  </view>
</template>
