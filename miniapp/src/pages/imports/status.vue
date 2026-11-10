<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { importErrors } from '../../features/imports/api';
import { validId } from '../../features/recipes/validation';
import { AppError } from '../../shared/errors';
let id = ''; let invalid = false; let timer: ReturnType<typeof globalThis.setTimeout> | undefined; let revision = 0;
onLoad(query => { try { if (query?.id) id = validId(query.id); } catch { invalid = true; } });
const page = useRecipesPage(async () => {
  if (invalid) throw new AppError('INVALID_INPUT');
  const saved = page.imports.restore(); if (!id && saved?.kind === 'job') id = saved.id;
  if (!id) throw new AppError('NOT_FOUND'); await page.imports.get(id);
});
const { confirmed, busy, message, imports } = page; const { job } = imports;
const terminal = computed(() => !!job.value && ['succeeded', 'failed', 'cancelled'].includes(job.value.state));
const labels = { queued: '等待处理', running: '正在解析或审核', succeeded: '已保存到家庭菜谱', failed: '导入失败', cancelled: '已取消' };
function stop() { revision++; if (timer !== undefined) globalThis.clearTimeout(timer); timer = undefined; }
function schedule() {
  stop(); if (!confirmed.value || terminal.value || !job.value) return;
  const current = revision;
  timer = globalThis.setTimeout(async () => {
    timer = undefined;
    await page.act(async () => { await imports.get(id); });
    if (current === revision) schedule();
  }, 3000);
}
watch([confirmed, () => job.value?.state], schedule, { flush: 'sync' });
onBeforeUnmount(stop);
const open = (edit = false) => { if (job.value?.recipeId) uni.navigateTo({ url: '/pages/recipes/' + (edit ? 'edit' : 'detail') + '?id=' + job.value.recipeId }); };
const start = () => uni.redirectTo({ url: '/pages/imports/submit' });
const back = () => uni.switchTab({ url: '/pages/recipes/index' });
</script>
<template>
  <view class="page import-page">
    <view
      v-if="confirmed && job"
      data-protected
    >
      <text class="title">
        文本导入任务
      </text>
      <text
        class="notice"
        role="status"
      >
        {{ labels[job.state] }}
      </text>
      <text class="notice">
        AI 尝试次数：{{ job.attempts }} / 3
      </text>
      <text
        v-if="!terminal"
        class="notice"
      >
        可能等待约一分钟开始。关闭页面后任务继续；可从菜谱列表恢复最近任务。
      </text>
      <text
        v-if="job.error"
        class="notice"
        role="status"
      >
        {{ importErrors[job.error] }}
      </text>
      <view v-if="job.state === 'succeeded'">
        <button
          data-open
          @tap="open()"
        >
          打开已保存菜谱
        </button>
        <button
          data-edit
          @tap="open(true)"
        >
          核对并编辑菜谱
        </button>
      </view>
      <view v-if="!terminal">
        <text class="notice">
          取消后不会保存新菜谱；已经开始的 AI 调用可能仍产生费用。
        </text>
        <button
          data-cancel
          :disabled="busy"
          @tap="page.act(async () => { await imports.cancel(id); })"
        >
          取消任务
        </button>
      </view>
      <button
        v-if="terminal"
        data-new
        @tap="start"
      >
        重新导入
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
      v-if="message"
      data-retry
      @tap="page.check"
    >
      重新查询
    </button>
    <button @tap="back">
      返回菜谱
    </button>
  </view>
</template>
<style scoped>
.page { padding: 40rpx; }
.title { display: block; font-size: 40rpx; }
.notice { display: block; margin-top: 24rpx; }
button { margin: 24rpx 0; }
</style>
