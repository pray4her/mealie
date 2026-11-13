<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import type { ImportInput } from 'home-contracts';
import { usePageTypography } from '../../shared/use-page-typography';
import { reactive, ref, watch } from 'vue';
import { onUnload } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { textInput, urlInput } from '../../features/imports/api';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
import { useImportImage } from '../../features/imports/use-import-image';
import { errorCode } from '../../shared/errors';
const { rootFontSize } = usePageTypography();
const method = ref<'text' | 'url' | 'image'>('text');
const text = ref(''); const baseline = ref(''); const url = ref(''); const urlBaseline = ref(''); const details = ref(false);
const acknowledgedJob = ref('');
const fields = reactive(useFieldIssues()); const form = ref<FormInstance>(); let initializedScope = ''; let initializedUid: string | undefined;
let submittingSource: ImportInput | undefined; let submittedRequest: { requestId: string; source: ImportInput } | null = null;
const sameSource = (a: ImportInput, b: ImportInput) => JSON.stringify(a) === JSON.stringify(b);
const currentSource = (): ImportInput => method.value === 'text' ? { kind: 'text', text: text.value } : method.value === 'url' ? { kind: 'url', url: url.value } : { kind: 'image', mediaId: image.item.value?.mediaId || '' };
const page = useRecipesPage(async () => {
  const nextScope = scope();
  const saved = page.imports.restore();
  if (initializedScope !== nextScope) {
    const pending = saved?.kind === 'pending' ? saved.input : null;
    method.value = pending?.source.kind ?? 'text';
    text.value = pending?.source.kind === 'text' ? pending.source.text : '';
    url.value = pending?.source.kind === 'url' ? pending.source.url : '';
    baseline.value = text.value; urlBaseline.value = url.value; initializedScope = nextScope; initializedUid = page.auth.identity.value?.uid;
    submittedRequest = pending ? { requestId: pending.requestId, source: pending.source } : null;
    if (pending?.source.kind === 'image') image.restore(pending.source.mediaId);
  }
});
const image = useImportImage(page);
const { item: imageItem, path: imagePath, message: imageMessage, busy: imageBusy, status: imageStatus, canSubmit: imageCanSubmit, canRetry: imageCanRetry } = image;
const { confirmed, busy, message, imports } = page; const { recovery } = imports;
const scope = () => { const view = page.family.view.value; return view ? view.uid + ':' + view.familyId + ':' + view.generation : ''; };
function reset() { method.value = 'text'; text.value = ''; baseline.value = ''; url.value = ''; urlBaseline.value = ''; image.clear(); initializedScope = ''; acknowledgedJob.value = ''; submittedRequest = null; submittingSource = undefined; fields.errors = {}; fields.focused = ''; }
watch(recovery, saved => {
  if (saved?.kind === 'pending' && submittingSource && sameSource(saved.input.source, submittingSource)) submittedRequest = { requestId: saved.input.requestId, source: saved.input.source };
  else if (saved?.kind === 'job' && submittedRequest) {
    if (sameSource(currentSource(), submittedRequest.source)) {
      if (submittedRequest.source.kind === 'text') { text.value = ''; baseline.value = ''; } else if (submittedRequest.source.kind === 'url') { url.value = ''; urlBaseline.value = ''; } else image.clear();
      fields.errors = {}; acknowledgedJob.value = saved.id;
    }
    submittedRequest = null;
  }
}, { flush: 'sync' });
watch([page.auth.phase, () => page.auth.identity.value?.uid, page.family.phase, page.family.view], ([phase, uid, familyPhase]) => {
  if (phase === 'anonymous' || phase === 'signing-out' || initializedScope && (uid && uid !== initializedUid || familyPhase === 'ready' && scope() !== initializedScope)) reset();
}, { flush: 'sync' });
onUnload(reset);
const leave = useLeaveGuard(() => text.value !== baseline.value || url.value !== urlBaseline.value || !!imageItem.value, () => (!initializedScope || page.auth.phase.value === 'unavailable' || page.auth.identity.value?.uid === initializedUid)
  && (page.family.phase.value !== 'ready' || !initializedScope || scope() === initializedScope), () => initializedScope);
function issues() {
  if (method.value === 'image') return imageCanSubmit.value ? [] : [{ path: ['image'], message: '请先选择一张菜谱图片，完成上传并通过审核。' }];
  try { if (method.value === 'text') textInput(text.value); else urlInput(url.value); return []; }
  catch { return [{ path: [method.value], message: method.value === 'text' ? '请输入一道菜的有效原文，不超过 16 KiB（中文约 5400 字）。' : '请输入公开可访问的菜谱网址（http/https，不超过 2048 字符）。' }]; }
}
const schema: FormSchema = { validate: issues };
function changed() { acknowledgedJob.value = ''; fields.clear(method.value); form.value?.reset(); }
function choose(next: 'text' | 'url' | 'image') { if (method.value === next) return; method.value = next; acknowledgedJob.value = ''; fields.errors = {}; fields.focused = ''; form.value?.reset(); }
function chooseImage() { changed(); image.choose(); }
function openAcknowledgedJob() { if (page.isCurrent() && acknowledgedJob.value) uni.navigateTo({ url: '/pages/imports/status?id=' + acknowledgedJob.value }); }
async function validate() { const before = scope(); await form.value?.validate(method.value); if (page.isCurrent() && before === scope()) fields.set(issues(), () => method.value); }
function submit(replay = false) { void page.act(async current => {
  if (replay && recovery.value?.kind !== 'pending') return;
  if (recovery.value?.kind !== 'pending') { await validate(); if (!current()) return; if (fields.errors[method.value]) { await fields.reveal(); return; } }
  const source = currentSource();
  submittingSource = source;
  let job;
  try { job = await imports.submit(source); }
  catch (error) {
    if (source.kind === 'image' && current() && ['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT'].includes(errorCode(error))) { image.clear(); fields.errors.image = '图片已失效或不可用于此任务，请重新选择并上传。'; return; }
    throw error;
  }
  finally { submittingSource = undefined; }
  if (current()) {
    if (method.value === 'text') { text.value = ''; baseline.value = ''; } else if (method.value === 'url') { url.value = ''; urlBaseline.value = ''; } else image.clear();
    leave.disable(); uni.redirectTo({ url: '/pages/imports/status?id=' + job.id });
  }
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
        AI 导入
      </text>
      <text class="notice">
        提供一道菜的文字、菜谱图片或公开网址，交由第三方 AI 处理；解析成功后自动保存到家庭菜谱。请勿提供隐私或敏感信息。
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
        <text>仅支持一道菜。图片每次一张 JPEG/PNG，不超过 1 MiB，须包含可读的食材和做法；上传后先进行微信内容审核，确认导入后才交 OpenRouter 识别。只有成品照片无法还原菜谱，未知数量和单位保留为空；原图不会作为菜谱封面。</text>
        <text>网址先经 Jina Reader 读取公开网页，再交 OpenRouter 解析；需登录、付费或拒绝访问的网页无法读取。文字不超过 16 KiB，原始素材最多保留七天，任务结束后提前清理。</text>
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
      <view class="method-tabs">
        <HomeAction
          label="粘贴正文"
          data-method-text
          type="info"
          variant="text"
          :pressed="method === 'text'"
          :disabled="busy || recovery?.kind === 'pending'"
          :custom-class="method === 'text' ? 'scope-tab scope-tab--active' : 'scope-tab'"
          @click="choose('text')"
        >
          粘贴正文
        </HomeAction>
        <HomeAction
          label="图片导入"
          data-method-image
          type="info"
          variant="text"
          :pressed="method === 'image'"
          :disabled="busy || imageBusy || recovery?.kind === 'pending'"
          :custom-class="method === 'image' ? 'scope-tab scope-tab--active' : 'scope-tab'"
          @click="choose('image')"
        >
          图片导入
        </HomeAction>
        <HomeAction
          label="网址导入"
          data-method-url
          type="info"
          variant="text"
          :pressed="method === 'url'"
          :disabled="busy || recovery?.kind === 'pending'"
          :custom-class="method === 'url' ? 'scope-tab scope-tab--active' : 'scope-tab'"
          @click="choose('url')"
        >
          网址导入
        </HomeAction>
      </view>
      <wd-form
        ref="form"
        :model="{ text, url, image: imageItem?.mediaId || '' }"
        :schema="schema"
        error-type="none"
        :disabled="busy || recovery?.kind === 'pending'"
        :reset-on-change="false"
      >
        <wd-form-item
          v-if="method === 'text'"
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
        <wd-form-item
          v-else-if="method === 'url'"
          prop="url"
          layout="vertical"
          custom-class="home-form-item"
        >
          <text class="field-label">
            菜谱网址
          </text>
          <input
            id="url"
            class="home-input"
            placeholder-style="color: var(--home-muted); opacity: 1"
            data-url
            type="text"
            :value="url"
            :maxlength="2048"
            :disabled="busy || recovery?.kind === 'pending'"
            aria-label="菜谱网址"
            :aria-invalid="!!fields.errors.url"
            :aria-describedby="fields.errors.url ? 'url-error' : undefined"
            :focus="fields.focused === 'url'"
            :cursor-spacing="32"
            placeholder="https://…（公开可访问的菜谱网页）"
            @input="url = $event.detail.value; changed()"
            @blur="validate"
          >
          <text
            v-if="fields.errors.url"
            id="url-error"
            class="field-error"
            role="alert"
            aria-role="alert"
          >
            {{ fields.errors.url }}
          </text>
        </wd-form-item>
        <wd-form-item
          v-else
          prop="image"
          layout="vertical"
          custom-class="home-form-item"
        >
          <view id="image">
            <text class="field-label">
              菜谱照片或截图
            </text>
            <text class="helper">
              一张图片，包含一道菜的食材和做法。JPEG/PNG，不超过 1 MiB。
            </text>
            <image
              v-if="imagePath"
              data-import-preview
              class="import-preview"
              :src="imagePath"
              mode="aspectFit"
              aria-label="所选菜谱图片预览"
            />
            <HomeAction
              v-if="imagePath"
              label="查看所选原图"
              type="info"
              variant="text"
              @click="image.preview"
            >
              查看原图
            </HomeAction>
            <HomeAction
              label="选择菜谱图片"
              data-choose-import-image
              type="info"
              :disabled="busy || imageBusy || recovery?.kind === 'pending'"
              @click="chooseImage"
            >
              {{ imageItem ? '重新选择图片' : '从相册选择或拍照' }}
            </HomeAction>
            <text
              v-if="imageStatus"
              aria-role="status"
            >
              {{ imageStatus }}
            </text>
            <text
              v-if="imageItem?.review === 'mock'"
              class="helper"
            >
              模拟审核，仅用于本地测试
            </text>
            <HomeAction
              v-if="imageItem"
              label="刷新图片审核状态"
              data-refresh-import-image
              type="info"
              variant="text"
              :disabled="busy || imageBusy"
              @click="image.refresh"
            >
              刷新状态
            </HomeAction>
            <HomeAction
              v-if="imageCanRetry"
              label="重试图片上传或审核"
              data-retry-import-image
              type="info"
              variant="text"
              :disabled="busy || imageBusy || recovery?.kind === 'pending'"
              @click="image.retry"
            >
              重试图片处理
            </HomeAction>
            <text
              v-if="imageMessage"
              class="field-error"
              aria-role="alert"
            >
              {{ imageMessage }}
            </text>
            <text
              v-if="fields.errors.image"
              id="image-error"
              class="field-error"
              aria-role="alert"
            >
              {{ fields.errors.image }}
            </text>
          </view>
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
        :disabled="busy || imageBusy || method === 'image' && !imageCanSubmit"
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
.method-tabs { display: flex; flex-wrap: wrap; align-items: stretch; gap: 12px 24px; border-bottom: 1px solid var(--home-line); margin-top: 16px; }
.import-preview { display: block; width: 100%; height: 12rem; margin: 12px 0; background: var(--home-bg); }
</style>
