<script setup lang="ts">
import { ref, watch } from 'vue';
import { onHide, onUnload } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
const text = ref('');
const page = useRecipesPage(async () => {
  const saved = page.imports.restore(); text.value = saved?.kind === 'pending' && saved.input.source.kind === 'text' ? saved.input.source.text : '';
});
const { confirmed, busy, message, imports } = page; const { recovery } = imports;
watch(page.auth.signOutEpoch, () => { text.value = ''; });
onHide(() => { text.value = ''; }); onUnload(() => { text.value = ''; });
function submit() { void page.act(async current => { const job = await imports.submit(text.value); if (current()) { text.value = ''; uni.redirectTo({ url: '/pages/imports/status?id=' + job.id }); } }); }
const back = () => uni.reLaunch({ url: '/pages/recipes/index' });
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        AI 文本导入
      </text>
      <text class="notice">
        仅支持一道菜的文字。图片和网址导入暂不可用。原文将交由第三方 AI（OpenRouter）处理，请勿粘贴个人隐私或敏感信息。
      </text>
      <text class="notice">
        可能等待约一分钟开始；取得任务后，关闭页面后任务继续，解析成功会自动保存到家庭菜谱。
      </text>
      <text class="notice">
        原文不超过 16 KiB，云端最多保留七天。AI 可能出错，请保存后核对并编辑。
      </text>
      <text class="label">
        菜谱原文
      </text>
      <textarea
        data-text
        :value="text"
        :maxlength="16384"
        :disabled="busy || recovery?.kind === 'pending'"
        aria-label="菜谱原文"
        placeholder="粘贴一道菜的标题、食材和做法"
        @input="text = $event.detail.value"
      />
      <view v-if="recovery?.kind === 'pending'">
        <text role="status">
          上次提交结果尚未确认，原请求已保存，请恢复查询。
        </text>
        <button
          data-replay
          :disabled="busy"
          @tap="submit"
        >
          恢复原请求
        </button>
      </view>
      <button
        v-else
        data-submit
        :disabled="busy || !text.trim()"
        @tap="submit"
      >
        同意第三方 AI 处理并导入
      </button>
      <text
        v-if="message"
        role="status"
      >
        {{ message }}
      </text>
    </view>
    <text
      v-else
      role="status"
    >
      {{ message || '正在确认登录与家庭…' }}
    </text>
    <button
      v-if="!confirmed && message"
      data-retry
      @tap="page.check"
    >
      重新确认
    </button>
    <button @tap="back">
      返回菜谱
    </button>
  </view>
</template>
<style scoped>
.page { padding: 40rpx; }
.title { display: block; font-size: 40rpx; }
.notice, .label { display: block; margin-top: 24rpx; }
textarea { box-sizing: border-box; width: 100%; height: 440rpx; margin-top: 16rpx; padding: 16rpx; background: white; border: 1rpx solid #76766d; border-radius: 8rpx; }
button { margin: 24rpx 0; }
</style>
