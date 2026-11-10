<script setup lang="ts">
import { ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { RecipeInput } from 'home-contracts';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { editable, parseInput, validId } from '../../features/recipes/validation';
import { AppError, errorCode } from '../../shared/errors';
import PrivateImage from '../../components/PrivateImage.vue';
import type { Cover } from '../../features/recipes/use-recipe-covers';
import { copy } from '../../shared/copy';

let sequence = 0;
const ingredient = () => ({ key: ++sequence, raw: '', name: '', quantity: '', unit: '', note: '' });
const step = () => ({ key: ++sequence, text: '' });
const draft = ref({ title: '', description: '', baseServings: '', prepMinutes: '', cookMinutes: '', ingredients: [ingredient()], steps: [step()], tags: '' });
const id = ref<string | null>(null); let version = 1; let initializedScope = ''; let invalidId = false;
const page = useRecipesPage(initialize);
const { confirmed, busy, message, recipes, media } = page;
const { items: images, pending: pendingImages, canSave: canSaveImages } = media;
const { pending } = recipes;
let lastUid = page.auth.identity.value?.uid;
watch([page.auth.phase, () => page.auth.identity.value?.uid, page.family.phase, page.family.view], ([phase, uid, familyPhase, view]) => {
  const nextScope = view ? view.uid + ':' + view.familyId + ':' + view.generation : '';
  if (phase === 'anonymous' || phase === 'signing-out' || (uid && lastUid && uid !== lastUid)
    || (familyPhase === 'ready' && initializedScope && nextScope !== initializedScope)) {
    initializedScope = ''; id.value = null; version = 1; apply(blank());
  }
  if (uid) lastUid = uid;
}, { flush: 'sync' });
onLoad(query => { if (query?.id !== undefined) { try { id.value = validId(query.id); } catch { invalidId = true; } } });
function apply(input: RecipeInput) {
  draft.value = { title: input.title, description: input.description ?? '', baseServings: input.baseServings?.toString() ?? '',
    prepMinutes: input.prepMinutes?.toString() ?? '', cookMinutes: input.cookMinutes?.toString() ?? '', tags: input.tags.join('，'),
    ingredients: input.ingredients.map(row => ({ key: ++sequence, raw: row.raw, name: row.name, quantity: row.quantity?.toString() ?? '', unit: row.unit ?? '', note: row.note ?? '' })),
    steps: input.steps.map(text => ({ key: ++sequence, text })) };
}
function blank(): RecipeInput { return { title: '', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '', name: '', quantity: null, unit: null, note: null }], steps: [''], tags: [] }; }
async function initialize() {
  if (invalidId) throw new AppError('INVALID_INPUT');
  const view = page.family.view.value!;
  const scope = view.uid + ':' + view.familyId + ':' + view.generation;
  if (initializedScope === scope) {
    if (id.value) { const value = await recipes.get(id.value); if (value) await media.initialize(value, true); }
    return;
  }
  const intent = recipes.restore();
  if (intent) {
    id.value = intent.kind === 'update' ? intent.input.id : null;
    version = intent.kind === 'update' ? intent.input.version : 1; apply(intent.input.recipe);
  } else if (id.value) {
    const value = await recipes.get(id.value); if (!value) return;
    version = value.version; apply(editable(value)); await media.initialize(value, true);
  } else apply(blank());
  initializedScope = scope;
}
const nullable = (text: string) => text.trim() || null;
const number = (text: string) => text.trim() === '' ? null : Number(text);
function input(): RecipeInput {
  const value = draft.value;
  return parseInput({ title: value.title, description: nullable(value.description), baseServings: number(value.baseServings),
    prepMinutes: number(value.prepMinutes), cookMinutes: number(value.cookMinutes),
    ingredients: value.ingredients.map(row => ({ raw: row.raw, name: row.name, quantity: number(row.quantity), unit: nullable(row.unit), note: nullable(row.note) })),
    steps: value.steps.map(row => row.text), tags: value.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) });
}
async function save(resume = false) {
  await page.act(async isCurrent => {
    let value: RecipeInput;
    try { value = pending.value ? pending.value.input.recipe as RecipeInput : input(); }
    catch { message.value = copy.invalidRecipe; return; }
    const result = resume ? await recipes.retry() : await recipes.submit(value, id.value ? { id: id.value, version } : undefined);
    if (!isCurrent()) return;
    id.value = result.id; version = result.version;
    uni.redirectTo({ url: '/pages/recipes/detail?id=' + result.id });
  });
}
async function reload() {
  await page.act(async isCurrent => {
    const result = await uni.showModal({ title: copy.reloadRecipe, content: copy.reloadRecipeConfirm, confirmText: copy.reloadRecipe, cancelText: copy.cancel });
    if (!result.confirm || !isCurrent() || !id.value || pending.value) return;
    const value = await recipes.get(id.value);
    if (value && isCurrent()) { apply(editable(value)); version = value.version; await media.initialize(value, true); }
  });
}
async function saveImages() {
  await page.act(async isCurrent => {
    if (!id.value || pending.value) return;
    const result = await media.save(id.value, version);
    if (isCurrent()) { version = result.version; message.value = '图片已保存，文字草稿仍保留。'; }
  });
}
async function chooseImage() {
  await page.act(async (isCurrent, resume) => {
    try { await media.choose(isCurrent, resume); }
    catch (error) {
      if (errorCode(error) === 'INVALID_INPUT') { if (isCurrent()) message.value = '请选择有效的 JPEG 或 PNG 图片，单张不能超过 1 MiB。'; }
      else throw error;
    }
    finally { if (isCurrent()) await media.refresh(); }
  });
}
function cover(mediaId: string): Cover { return { state: media.linkErrors.value[mediaId] ?? media.items.value.find(item => item.mediaId === mediaId)?.state ?? 'loading', url: media.links.value[mediaId]?.url }; }
const imageState = { requested: '尚未上传，请移除后重新选择', uploading: '正在上传', uploaded: '上传完成，点击重试校验', checking: '正在校验', pending: '等待审核，可刷新状态', ready: '可保存', rejected: '审核未通过，请移除并更换图片', 'review-error': '审核异常或超时，可重试', failed: '上传失败，请移除后重新选择' };
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ id ? copy.editRecipe : copy.createRecipe }}
      </text>
      <text class="helper">
        把食材和做法记清楚，下次做饭更从容。
      </text>
      <view
        v-if="pending"
        class="notice"
        role="status"
      >
        <text>{{ copy.pendingRecipe }}</text><wd-button
          data-resume
          :disabled="busy || !!pendingImages"
          :loading="busy"
          @click="save(true)"
        >
          {{ copy.resumeRecipe }}
        </wd-button>
      </view>
      <view class="form">
        <view class="form-section">
          <text class="section">
            基本信息
          </text>
          <text class="field-label">
            {{ copy.recipeTitle }}
          </text>
          <wd-input
            v-model="draft.title"
            data-title
            :maxlength="240"
            :disabled="busy || !!pending"
            :aria-label="copy.recipeTitle"
            :placeholder="copy.recipeTitle"
            :cursor-spacing="24"
          />
          <text class="field-label">
            {{ copy.recipeDescription }}
          </text>
          <wd-textarea
            v-model="draft.description"
            data-description
            :maxlength="4000"
            :disabled="busy || !!pending"
            :aria-label="copy.recipeDescription"
            :placeholder="copy.recipeDescription"
            auto-height
            :cursor-spacing="24"
          />
          <text class="field-label">
            {{ copy.servings }}
          </text>
          <wd-input
            v-model="draft.baseServings"
            data-servings
            type="digit"
            :disabled="busy || !!pending"
            :aria-label="copy.servings"
            placeholder="未知可留空"
            :cursor-spacing="24"
          />
          <text class="field-label">
            {{ copy.prepMinutes }}
          </text>
          <wd-input
            v-model="draft.prepMinutes"
            data-prep
            type="digit"
            :disabled="busy || !!pending"
            :aria-label="copy.prepMinutes"
            placeholder="未知可留空"
            :cursor-spacing="24"
          />
          <text class="field-label">
            {{ copy.cookMinutes }}
          </text>
          <wd-input
            v-model="draft.cookMinutes"
            data-cook
            type="digit"
            :disabled="busy || !!pending"
            :aria-label="copy.cookMinutes"
            placeholder="未知可留空"
            :cursor-spacing="24"
          />
        </view>
        <view class="form-section">
          <text class="section">
            {{ copy.ingredients }}
          </text>
          <text class="helper">
            保留原文，数量未知时留空，备注记录处理方式。
          </text>
          <view
            v-for="(row, index) in draft.ingredients"
            :key="row.key"
            class="row"
            data-ingredient
          >
            <text class="row-title">
              食材 {{ index + 1 }}
            </text>
            <text class="field-label">
              {{ copy.ingredientRaw }}
            </text>
            <wd-input
              v-model="row.raw"
              data-raw
              :maxlength="1000"
              :disabled="busy || !!pending"
              :aria-label="copy.ingredientRaw"
              :cursor-spacing="24"
            />
            <text class="field-label">
              {{ copy.ingredientName }}
            </text>
            <wd-input
              v-model="row.name"
              data-name
              :maxlength="200"
              :disabled="busy || !!pending"
              :aria-label="copy.ingredientName"
              :cursor-spacing="24"
            />
            <text class="field-label">
              {{ copy.quantity }}
            </text>
            <wd-input
              v-model="row.quantity"
              data-quantity
              type="digit"
              :disabled="busy || !!pending"
              :aria-label="copy.quantity"
              placeholder="未知可留空"
              :cursor-spacing="24"
            />
            <text class="field-label">
              {{ copy.unit }}
            </text>
            <wd-input
              v-model="row.unit"
              data-unit
              :maxlength="80"
              :disabled="busy || !!pending"
              :aria-label="copy.unit"
              :cursor-spacing="24"
            />
            <text class="field-label">
              {{ copy.note }}
            </text>
            <wd-textarea
              v-model="row.note"
              data-note
              :maxlength="1000"
              :disabled="busy || !!pending"
              :aria-label="copy.note"
              auto-height
              :cursor-spacing="24"
            />
            <wd-button
              data-remove-ingredient
              variant="text"
              :disabled="busy || !!pending || draft.ingredients.length === 1"
              :aria-label="'移除食材 ' + (index + 1)"
              @click="draft.ingredients.splice(index, 1)"
            >
              {{ copy.removeRow }}
            </wd-button>
          </view>
          <wd-button
            data-add-ingredient
            variant="plain"
            :disabled="busy || !!pending || draft.ingredients.length >= 100"
            @click="draft.ingredients.push(ingredient())"
          >
            {{ copy.addIngredient }}
          </wd-button>
        </view>
        <view class="form-section">
          <text class="section">
            {{ copy.steps }}
          </text>
          <view
            v-for="(row, index) in draft.steps"
            :key="row.key"
            class="row"
          >
            <text class="field-label">
              步骤 {{ index + 1 }}
            </text>
            <wd-textarea
              v-model="row.text"
              data-step
              :maxlength="4000"
              :disabled="busy || !!pending"
              :aria-label="'步骤 ' + (index + 1)"
              :placeholder="copy.step"
              auto-height
              :cursor-spacing="24"
            />
            <wd-button
              data-remove-step
              variant="text"
              :disabled="busy || !!pending || draft.steps.length === 1"
              :aria-label="'移除步骤 ' + (index + 1)"
              @click="draft.steps.splice(index, 1)"
            >
              {{ copy.removeRow }}
            </wd-button>
          </view>
          <wd-button
            data-add-step
            variant="plain"
            :disabled="busy || !!pending || draft.steps.length >= 50"
            @click="draft.steps.push(step())"
          >
            {{ copy.addStep }}
          </wd-button>
        </view>
        <view class="form-section">
          <text class="section">
            标签
          </text>
          <text class="field-label">
            {{ copy.tags }}
          </text>
          <wd-input
            v-model="draft.tags"
            data-tags
            :maxlength="1640"
            :disabled="busy || !!pending"
            :aria-label="copy.tags"
            :placeholder="copy.tags"
            :cursor-spacing="24"
          />
        </view>
        <view class="save-actions">
          <wd-button
            v-if="!pending"
            data-save
            block
            size="large"
            :disabled="busy || !!pendingImages"
            :loading="busy"
            @click="save()"
          >
            {{ copy.saveRecipe }}
          </wd-button>
          <wd-button
            v-if="id && !pending"
            data-reload
            variant="text"
            :disabled="busy"
            @click="reload"
          >
            {{ copy.reloadRecipe }}
          </wd-button>
        </view>
      </view>
      <view
        class="form-section"
        data-images
      >
        <text class="section">
          菜谱图片
        </text>
        <text class="helper">
          JPEG / PNG，单张最多 1 MiB，最多 20 张。图片单独保存，文字草稿会保留。
        </text>
        <text
          v-if="!id"
          class="notice"
        >
          请先保存菜谱文字，再进入编辑页添加图片。
        </text>
        <view v-else>
          <text
            v-if="Object.keys(media.linkErrors.value).length"
            class="notice"
            role="status"
          >
            部分图片加载失败或链接已到期，可以刷新图片状态。
          </text>
          <view
            v-for="image in images"
            :key="image.mediaId"
            class="row"
            data-image
          >
            <PrivateImage
              :cover="cover(image.mediaId)"
              label="菜谱图片"
              :busy="busy"
              preview
              @error="media.failLink(image.mediaId)"
              @retry="page.act(async () => { await media.refresh(); })"
              @open="page.act(async () => { await media.preview(image.mediaId); })"
            />
            <text
              class="helper"
              role="status"
            >
              {{ imageState[image.state] }}{{ image.review === 'mock' ? '（模拟审核）' : '' }}
            </text>
            <wd-button
              v-if="image.retryable"
              data-retry-image
              variant="text"
              :disabled="busy || !!pendingImages"
              @click="page.act(async () => { await media.retry(image.mediaId); })"
            >
              重试图片处理
            </wd-button>
            <wd-button
              data-remove-image
              variant="text"
              :disabled="busy || !!pendingImages"
              @click="media.remove(image.mediaId)"
            >
              移除图片
            </wd-button>
          </view>
          <view class="image-actions">
            <wd-button
              data-choose-image
              variant="plain"
              :disabled="busy || !!pending || !!pendingImages || images.length >= 20"
              @click="chooseImage"
            >
              选择图片
            </wd-button>
            <wd-button
              data-refresh-images
              variant="text"
              :disabled="busy"
              @click="page.act(async () => { await media.refresh(); })"
            >
              刷新图片状态
            </wd-button>
            <wd-button
              data-save-images
              :disabled="busy || !!pending || !canSaveImages"
              @click="saveImages"
            >
              {{ pendingImages ? '恢复原图片保存请求' : '保存图片' }}
            </wd-button>
          </view>
          <text
            v-if="pendingImages"
            class="notice"
            role="status"
          >
            上次保存结果未知，请恢复原请求后继续编辑。
          </text>
        </view>
      </view>
    </view>
    <text
      v-else
      class="notice"
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <text
      v-if="confirmed && message"
      class="notice"
      role="status"
    >
      {{ message }}
    </text>
    <wd-button
      v-if="message"
      data-check
      variant="text"
      :disabled="busy"
      @click="page.check"
    >
      {{ copy.retry }}
    </wd-button>
    <wd-button
      variant="text"
      @click="page.back"
    >
      {{ copy.back }}
    </wd-button>
  </view>
</template>
<style scoped>
.page { padding: 24px 20px calc(32px + env(safe-area-inset-bottom)); background: var(--app-surface); }
.title { display: block; font-size: 24px; font-weight: 600; }
.helper { display: block; margin-top: 8px; color: var(--app-text-secondary); font-size: 14px; }
.form-section { margin-top: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--app-border); }
.section { display: block; font-size: 18px; font-weight: 600; margin-bottom: 12px; }
.field-label { display: block; margin: 16px 0 8px; font-size: 14px; }
.row { margin: 16px 0; padding-bottom: 16px; border-bottom: 1px solid var(--app-border); }
.row-title { font-size: 16px; font-weight: 600; }
.form :deep(.wd-input), .form :deep(.wd-textarea) { padding: 10px 12px; border: 1px solid #78867c; border-radius: 8px; }
.form :deep(.wd-input__inner), .form :deep(.wd-textarea__inner) { font-size: 16px; }
.save-actions { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
.image-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.notice { display: block; margin: 20px 0; white-space: pre-wrap; }
@media (max-width: 340px) { .page { padding-left: 16px; padding-right: 16px; } }
</style>
