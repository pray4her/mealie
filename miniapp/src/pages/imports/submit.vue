<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import { usePageTypography } from '../../shared/use-page-typography';
import { reactive, ref, watch } from 'vue';
import { onUnload } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { textInput } from '../../features/imports/api';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
const { rootFontSize } = usePageTypography();
const text = ref(''); const baseline = ref(''); const details = ref(false);
const acknowledgedJob = ref('');
const fields = reactive(useFieldIssues()); const form = ref<FormInstance>(); let initializedScope = ''; let initializedUid: string | undefined;
let submittingText: string | undefined; let submittedRequest: { requestId: string; text: string } | null = null;
const page = useRecipesPage(async () => {
  const nextScope = scope();
  const saved = page.imports.restore();
  if (initializedScope !== nextScope) {
    text.value = saved?.kind === 'pending' && saved.input.source.kind === 'text' ? saved.input.source.text : '';
    baseline.value = text.value; initializedScope = nextScope; initializedUid = page.auth.identity.value?.uid;
    submittedRequest = saved?.kind === 'pending' && saved.input.source.kind === 'text' ? { requestId: saved.input.requestId, text: saved.input.source.text } : null;
  }
});
const { confirmed, busy, message, imports } = page; const { recovery } = imports;
const scope = () => { const view = page.family.view.value; return view ? view.uid + ':' + view.familyId + ':' + view.generation : ''; };
function reset() { text.value = ''; baseline.value = ''; initializedScope = ''; acknowledgedJob.value = ''; submittedRequest = null; submittingText = undefined; fields.errors = {}; fields.focused = ''; }
watch(recovery, saved => {
  if (saved?.kind === 'pending' && saved.input.source.kind === 'text' && saved.input.source.text === submittingText) submittedRequest = { requestId: saved.input.requestId, text: saved.input.source.text };
  else if (saved?.kind === 'job' && submittedRequest) {
    if (text.value === submittedRequest.text) { text.value = ''; baseline.value = ''; fields.errors = {}; acknowledgedJob.value = saved.id; }
    submittedRequest = null;
  }
}, { flush: 'sync' });
watch([page.auth.phase, () => page.auth.identity.value?.uid, page.family.phase, page.family.view], ([phase, uid, familyPhase]) => {
  if (phase === 'anonymous' || phase === 'signing-out' || initializedScope && (uid && uid !== initializedUid || familyPhase === 'ready' && scope() !== initializedScope)) reset();
}, { flush: 'sync' });
onUnload(reset);
const leave = useLeaveGuard(() => text.value !== baseline.value, () => (!initializedScope || page.auth.phase.value === 'unavailable' || page.auth.identity.value?.uid === initializedUid)
  && (page.family.phase.value !== 'ready' || !initializedScope || scope() === initializedScope), () => initializedScope);
function issues() {
  try { textInput(text.value); return []; }
  catch { return [{ path: ['text'], message: '请输入一道菜的有效原文，不超过 16 KiB（中文约 5400 字）。' }]; }
}
const schema: FormSchema = { validate: issues };
function changed() { acknowledgedJob.value = ''; fields.clear('text'); form.value?.reset(); }
function openAcknowledgedJob() { if (page.isCurrent() && acknowledgedJob.value) uni.navigateTo({ url: '/pages/imports/status?id=' + acknowledgedJob.value }); }
async function validate() { const before = scope(); await form.value?.validate('text'); if (page.isCurrent() && before === scope()) fields.set(issues(), () => 'text'); }
function submit(replay = false) { void page.act(async current => {
  if (replay && recovery.value?.kind !== 'pending') return;
  if (recovery.value?.kind !== 'pending') { await validate(); if (!current()) return; if (fields.errors.text) { await fields.reveal(); return; } }
  submittingText = text.value;
  let job;
  try { job = await imports.submit(text.value); }
  finally { submittingText = undefined; }
  if (current()) { text.value = ''; baseline.value = ''; leave.disable(); uni.redirectTo({ url: '/pages/imports/status?id=' + job.id }); }
}); }
async function back() { if (await leave.confirm()) uni.switchTab({ url: '/pages/recipes/index', fail: leave.sync }); }
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page import-page">
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
        AI 文本导入
      </text>
      <text class="notice">
        粘贴一道菜的文字，交由第三方 AI（OpenRouter）处理；解析成功后自动保存到家庭菜谱。请勿提供隐私或敏感信息。
      </text>
      <HomeAction
        :label="details ? '收起处理说明' : '查看处理与保留说明'"
        variant="text"
        type="info"
        :aria-expanded="details"
        @click="details = !details"
      >
        {{ details ? '收起处理说明' : '查看处理与保留说明' }}
      </HomeAction>
      <view
        v-if="details"
        class="notice"
      >
        <text>仅支持一道菜的文字，图片和网址导入暂不可用。原文不超过 16 KiB，云端最多保留七天。</text>
        <text>可能等待约一分钟开始；取得任务后，关闭页面后任务继续。AI 可能出错，请在自动保存后核对并编辑。</text>
      </view>
      <view
        v-if="acknowledgedJob"
        class="compact-notice"
        role="status"
        aria-role="status"
      >
        <text>上次提交已确认，任务会继续处理。</text>
        <HomeAction
          label="查看导入任务"
          variant="text"
          data-acknowledged-job
          @click="openAcknowledgedJob"
        >
          查看导入任务
        </HomeAction>
      </view>
      <wd-form
        ref="form"
        :model="{ text }"
        :schema="schema"
        error-type="none"
        :disabled="busy || recovery?.kind === 'pending'"
        :reset-on-change="false"
      >
        <wd-form-item
          prop="text"
          layout="vertical"
          custom-class="home-form-item"
        >
          <text class="field-label">
            菜谱原文
          </text>
          <textarea
            id="text"
            class="home-textarea"
            placeholder-style="color: var(--home-muted); opacity: 1"
            data-text
            :value="text"
            :maxlength="16384"
            :disabled="busy || recovery?.kind === 'pending'"
            aria-label="菜谱原文"
            :aria-invalid="!!fields.errors.text"
            :aria-describedby="fields.errors.text ? 'text-error' : undefined"
            :focus="fields.focused === 'text'"
            :cursor-spacing="32"
            placeholder="粘贴一道菜的标题、食材和做法"
            @input="text = $event.detail.value; changed()"
            @blur="validate"
          />
          <text
            v-if="fields.errors.text"
            id="text-error"
            class="field-error"
            role="alert"
            aria-role="alert"
          >
            {{ fields.errors.text }}
          </text>
        </wd-form-item>
      </wd-form>
      <text
        v-if="recovery?.kind === 'pending'"
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        上次提交结果尚未确认，原请求已保存，请恢复查询。
      </text>
      <HomeAction
        v-if="recovery?.kind === 'pending'"
        label="恢复原请求"
        data-replay
        :disabled="busy"
        :loading="busy"
        @click="submit(true)"
      >
        恢复原请求
      </HomeAction>
      <HomeAction
        v-else
        label="同意第三方 AI 处理并导入"
        data-submit
        :disabled="busy"
        :loading="busy"
        @click="submit()"
      >
        同意第三方 AI 处理并导入
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
      v-if="!confirmed && message"
      label="重新确认"
      type="info"
      variant="text"
      data-retry
      @click="page.check"
    >
      重新确认
    </HomeAction>
    <HomeAction
      label="返回菜谱"
      type="info"
      variant="text"
      data-back
      @click="back"
    >
      返回菜谱
    </HomeAction>
  </view>
</template>
<style scoped>
.home-textarea { min-height: 14rem; }
</style>
