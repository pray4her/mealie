<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { importErrors } from '../../features/imports/api';
import { validId } from '../../features/recipes/validation';
import { AppError } from '../../shared/errors';
const { rootFontSize } = usePageTypography();
let id = ''; let invalid = false; let timer: ReturnType<typeof globalThis.setTimeout> | undefined; let revision = 0;
onLoad(query => { try { if (query?.id) id = validId(query.id); } catch { invalid = true; } });
const page = useRecipesPage(async () => {
  if (invalid) throw new AppError('INVALID_INPUT');
  const saved = page.imports.restore(); if (!id && saved?.kind === 'job') id = saved.id;
  if (!id) throw new AppError('NOT_FOUND'); await page.imports.get(id);
});
const { confirmed, busy, message, imports } = page; const { job } = imports;
const details = ref(false);
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
async function cancel() {
  await page.act(async isCurrent => {
    const result = await uni.showModal({ title: '取消这次导入？', content: '取消后不会保存新菜谱；已经开始的 AI 调用可能仍产生费用。', confirmText: '取消导入', cancelText: '继续等待', confirmColor: '#b33f38' });
    if (result.confirm && isCurrent() && !terminal.value) await imports.cancel(id);
  });
}
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page import-page">
    <view
      v-if="confirmed && job"
      data-protected
    >
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
        {{ job.state === 'queued' || job.state === 'running' ? '正在整理这道菜' : labels[job.state] }}
      </text>
      <text
        class="compact-notice"
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ labels[job.state] }}
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
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ importErrors[job.error] }}
      </text>
      <HomeAction
        :label="details ? '收起处理详情' : '查看处理详情'"
        variant="text"
        data-details
        @click="details = !details"
      >
        {{ details ? '收起处理详情' : '查看处理详情' }}
      </HomeAction>
      <view
        v-if="details"
        class="status-details"
      >
        <text class="muted">
          AI 尝试次数：{{ job.attempts }} / 3。取消后不会保存新菜谱；已经开始的 AI 调用可能仍产生费用。
        </text>
      </view>
      <view v-if="job.state === 'succeeded'">
        <HomeAction
          label="打开已保存菜谱"
          data-open
          @click="open()"
        >
          打开已保存菜谱
        </HomeAction>
        <HomeAction
          label="核对并编辑菜谱"
          type="info"
          variant="plain"
          data-edit
          @click="open(true)"
        >
          核对并编辑菜谱
        </HomeAction>
      </view>
      <view v-if="!terminal">
        <HomeAction
          label="取消任务"
          type="danger"
          variant="text"
          data-cancel
          :disabled="busy"
          @click="cancel"
        >
          取消任务
        </HomeAction>
      </view>
      <HomeAction
        v-if="terminal"
        label="重新导入"
        :type="job.state === 'succeeded' ? 'info' : 'primary'"
        :variant="job.state === 'succeeded' ? 'plain' : 'base'"
        data-new
        @click="start"
      >
        重新导入
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
    </view>
    <text
      v-else
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ message || '正在确认登录与家庭…' }}
    </text>
    <HomeAction
      v-if="message"
      label="重新查询"
      type="info"
      variant="plain"
      data-retry
      @click="page.check"
    >
      重新查询
    </HomeAction>
    <HomeAction
      label="返回菜谱"
      :type="terminal ? 'info' : 'primary'"
      :variant="terminal ? 'text' : 'base'"
      @click="back"
    >
      返回菜谱
    </HomeAction>
  </view>
</template>
