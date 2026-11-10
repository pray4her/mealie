<script setup lang="ts">
import { computed } from 'vue';
import type { Cover } from '../features/recipes/use-recipe-covers';
const props = defineProps<{ cover?: Cover; label: string; busy?: boolean; preview?: boolean }>();
defineEmits<{ retry: []; error: []; open: [] }>();
const labels = { loading: '正在加载图片', ready: '正在加载图片', expired: '图片链接已到期', error: '图片加载失败',
  requested: '图片尚未上传', uploading: '图片上传中', uploaded: '图片待校验', checking: '图片校验中', pending: '图片审核中', rejected: '图片审核未通过', 'review-error': '图片审核异常', failed: '图片上传失败' };
const retryable = computed(() => props.cover && ['error', 'expired', 'pending', 'checking', 'uploaded', 'review-error'].includes(props.cover.state));
</script>
<template>
  <view class="private-image">
    <image
      v-if="cover?.url"
      data-private-image
      :src="cover.url"
      mode="aspectFill"
      :aria-label="label"
      class="photo"
      @error="$emit('error')"
      @tap="$emit('open')"
    />
    <view
      v-else
      class="placeholder"
      role="status"
    >
      <text>{{ cover ? labels[cover.state] : '还没有菜图' }}</text>
      <wd-button
        v-if="retryable"
        data-retry-cover
        variant="text"
        :disabled="busy"
        @click="$emit('retry')"
      >
        重新加载图片
      </wd-button>
    </view>
    <wd-button
      v-if="preview && cover?.url"
      custom-class="preview-image"
      variant="text"
      :disabled="busy"
      @click="$emit('open')"
    >
      查看原图
    </wd-button>
  </view>
</template>
<style scoped>
.private-image { position: relative; width: 100%; padding-top: 75%; background: #eff2ef; border-radius: 12px; overflow: hidden; }
.photo, .placeholder { position: absolute; inset: 0; width: 100%; height: 100%; }
.placeholder { display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box; padding: 12px; gap: 8px; color: var(--app-text); font-size: 14px; text-align: center; }
.private-image :deep(.preview-image) { position: absolute; right: 8px; bottom: 8px; padding: 0 12px; background: white; }
</style>
