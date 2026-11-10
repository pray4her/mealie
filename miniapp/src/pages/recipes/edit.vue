<script setup lang="ts">
import { ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { RecipeInput } from 'home-contracts';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { editable, parseInput, validId } from '../../features/recipes/validation';
import { AppError, errorCode } from '../../shared/errors';
import { copy } from '../../shared/copy';

let sequence = 0;
const ingredient = () => ({ key: ++sequence, raw: '', name: '', quantity: '', unit: '', note: '' });
const step = () => ({ key: ++sequence, text: '' });
const draft = ref({ title: '', description: '', baseServings: '', prepMinutes: '', cookMinutes: '', ingredients: [ingredient()], steps: [step()], tags: '' });
const id = ref<string | null>(null); let version = 1; let initializedScope = ''; let invalidId = false;
const page = useRecipesPage(initialize);
const { confirmed, busy, message, recipes, media } = page;
const { items: images, links: imageLinks, pending: pendingImages, canSave: canSaveImages } = media;
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
const imageState = { requested: '尚未上传，请移除后重新选择', uploading: '正在上传', uploaded: '上传完成，点击重试校验', checking: '正在校验', pending: '等待审核，可刷新状态', ready: '可保存', rejected: '审核未通过，请移除并更换图片', 'review-error': '审核异常或超时，可重试', failed: '上传失败，请移除后重新选择' };
</script>
<template>
  <view class="page editor-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ id ? copy.editRecipe : copy.createRecipe }}
      </text>
      <view
        v-if="pending"
        role="status"
      >
        <text>{{ copy.pendingRecipe }}</text>
        <wd-button
          type="primary"
          data-resume
          :disabled="busy || !!pendingImages"
          :aria-disabled="busy || !!pendingImages"
          :loading="busy"
          :aria-busy="busy"
          @click="save(true)"
        >
          {{ copy.resumeRecipe }}
        </wd-button>
      </view>
      <view class="form">
        <text>{{ copy.recipeTitle }}</text>
        <wd-input
          :cursor-spacing="32"
          data-title
          :model-value="draft.title"
          :maxlength="240"
          :disabled="busy || !!pending"
          :placeholder="copy.recipeTitle"
          @update:model-value="draft.title = $event"
        />
        <text>{{ copy.recipeDescription }}</text>
        <wd-textarea
          auto-height
          :cursor-spacing="32"
          data-description
          :model-value="draft.description"
          :maxlength="4000"
          :disabled="busy || !!pending"
          :placeholder="copy.recipeDescription"
          @update:model-value="draft.description = $event"
        />
        <text>{{ copy.servings }}</text>
        <wd-input
          :cursor-spacing="32"
          data-servings
          :placeholder="copy.servings + '，可留空'"
          type="digit"
          :model-value="draft.baseServings"
          :disabled="busy || !!pending"
          @update:model-value="draft.baseServings = $event"
        />
        <text>{{ copy.prepMinutes }}</text>
        <wd-input
          :cursor-spacing="32"
          data-prep
          :placeholder="copy.prepMinutes + '，可留空'"
          type="digit"
          :model-value="draft.prepMinutes"
          :disabled="busy || !!pending"
          @update:model-value="draft.prepMinutes = $event"
        />
        <text>{{ copy.cookMinutes }}</text>
        <wd-input
          :cursor-spacing="32"
          data-cook
          :placeholder="copy.cookMinutes + '，可留空'"
          type="digit"
          :model-value="draft.cookMinutes"
          :disabled="busy || !!pending"
          @update:model-value="draft.cookMinutes = $event"
        />
        <text class="section">
          {{ copy.ingredients }}
        </text>
        <view
          v-for="(row, index) in draft.ingredients"
          :key="row.key"
          class="row"
          data-ingredient
        >
          <text>{{ copy.ingredients }} {{ index + 1 }}</text>
          <text class="field-label">
            {{ copy.ingredientRaw }}
          </text>
          <wd-input
            :cursor-spacing="32"
            data-raw
            :model-value="row.raw"
            :maxlength="1000"
            :disabled="busy || !!pending"
            :placeholder="copy.ingredientRaw"
            @update:model-value="row.raw = $event"
          />
          <text class="field-label">
            {{ copy.ingredientName }}
          </text>
          <wd-input
            :cursor-spacing="32"
            data-name
            :model-value="row.name"
            :maxlength="200"
            :disabled="busy || !!pending"
            :placeholder="copy.ingredientName"
            @update:model-value="row.name = $event"
          />
          <text class="field-label">
            {{ copy.quantity }}（留空表示未注明）
          </text>
          <wd-input
            :cursor-spacing="32"
            data-quantity
            type="digit"
            :model-value="row.quantity"
            :disabled="busy || !!pending"
            :placeholder="copy.quantity"
            @update:model-value="row.quantity = $event"
          />
          <text class="field-label">
            {{ copy.unit }}
          </text>
          <wd-input
            :cursor-spacing="32"
            data-unit
            :model-value="row.unit"
            :maxlength="80"
            :disabled="busy || !!pending"
            :placeholder="copy.unit"
            @update:model-value="row.unit = $event"
          />
          <text class="field-label">
            {{ copy.note }}
          </text>
          <wd-textarea
            auto-height
            :cursor-spacing="32"
            data-note
            :model-value="row.note"
            :maxlength="1000"
            :disabled="busy || !!pending"
            :placeholder="copy.note"
            @update:model-value="row.note = $event"
          />
          <wd-button
            type="info"
            data-remove-ingredient
            :disabled="busy || !!pending || draft.ingredients.length === 1"
            :aria-disabled="busy || !!pending || draft.ingredients.length === 1"
            @click="draft.ingredients.splice(index, 1)"
          >
            {{ copy.removeRow }}
          </wd-button>
        </view>
        <wd-button
          type="info"
          data-add-ingredient
          :disabled="busy || !!pending || draft.ingredients.length >= 100"
          @click="draft.ingredients.push(ingredient())"
        >
          {{ copy.addIngredient }}
        </wd-button>
        <text class="section">
          {{ copy.steps }}
        </text>
        <view
          v-for="(row, index) in draft.steps"
          :key="row.key"
          class="row"
        >
          <text>{{ copy.steps }} {{ index + 1 }}</text>
          <wd-textarea
            auto-height
            :cursor-spacing="32"
            data-step
            :model-value="row.text"
            :maxlength="4000"
            :disabled="busy || !!pending"
            :placeholder="copy.step"
            @update:model-value="row.text = $event"
          />
          <wd-button
            type="info"
            data-remove-step
            :disabled="busy || !!pending || draft.steps.length === 1"
            :aria-disabled="busy || !!pending || draft.steps.length === 1"
            @click="draft.steps.splice(index, 1)"
          >
            {{ copy.removeRow }}
          </wd-button>
        </view>
        <wd-button
          type="info"
          data-add-step
          :disabled="busy || !!pending || draft.steps.length >= 50"
          @click="draft.steps.push(step())"
        >
          {{ copy.addStep }}
        </wd-button>
        <text>{{ copy.tags }}</text>
        <wd-input
          :cursor-spacing="32"
          data-tags
          :model-value="draft.tags"
          :maxlength="1640"
          :disabled="busy || !!pending"
          :placeholder="copy.tags"
          @update:model-value="draft.tags = $event"
        />
        <wd-button
          v-if="!pending"
          type="primary"
          data-save
          :disabled="busy || !!pendingImages"
          :aria-disabled="busy || !!pendingImages"
          :loading="busy"
          :aria-busy="busy"
          @click="save()"
        >
          {{ copy.saveRecipe }}
        </wd-button>
        <wd-button
          v-if="id && !pending"
          type="info"
          data-reload
          :disabled="busy"
          :aria-disabled="busy"
          @click="reload"
        >
          {{ copy.reloadRecipe }}
        </wd-button>
      </view>
      <view data-images>
        <text class="section">
          菜谱图片（JPEG / PNG，单张最多 1 MiB，最多 20 张）
        </text>
        <text v-if="!id">
          请先保存菜谱文字，再进入编辑页添加图片。
        </text>
        <view v-else>
          <view
            v-for="image in images"
            :key="image.mediaId"
            class="row"
            data-image
          >
            <image
              v-if="imageLinks[image.mediaId]"
              :src="imageLinks[image.mediaId].url"
              mode="aspectFit"
              class="recipe-image"
              aria-label="菜谱图片"
              @tap="page.act(async () => { await media.preview(image.mediaId); })"
            />
            <text role="status">
              {{ imageState[image.state] }}{{ image.review === 'mock' ? '（模拟审核）' : '' }}
            </text>
            <wd-button
              v-if="image.retryable"
              type="info"
              data-retry-image
              :disabled="busy || !!pendingImages"
              :aria-disabled="busy || !!pendingImages"
              @click="page.act(async () => { await media.retry(image.mediaId); })"
            >
              重试图片处理
            </wd-button>
            <wd-button
              type="info"
              data-remove-image
              :disabled="busy || !!pendingImages"
              :aria-disabled="busy || !!pendingImages"
              @click="media.remove(image.mediaId)"
            >
              移除图片
            </wd-button>
          </view>
          <wd-button
            type="info"
            data-choose-image
            :disabled="busy || !!pending || !!pendingImages || images.length >= 20"
            @click="chooseImage"
          >
            选择图片
          </wd-button>
          <wd-button
            type="info"
            data-refresh-images
            :disabled="busy"
            :aria-disabled="busy"
            @click="page.act(async () => { await media.refresh(); })"
          >
            刷新图片状态
          </wd-button>
          <wd-button
            type="info"
            data-save-images
            :disabled="busy || !!pending || !canSaveImages"
            :aria-disabled="busy || !!pending || !canSaveImages"
            @click="saveImages"
          >
            {{ pendingImages ? '恢复原图片保存请求' : '保存图片' }}
          </wd-button>
          <text
            v-if="pendingImages"
            role="status"
          >
            上次保存结果未知，请恢复原请求后继续编辑。
          </text>
        </view>
      </view>
    </view>
    <text
      v-else
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <text
      v-if="confirmed && message"
      role="status"
    >
      {{ message }}
    </text>
    <wd-button
      v-if="message"
      type="info"
      data-check
      @click="page.check"
    >
      {{ copy.retry }}
    </wd-button>
    <wd-button
      type="info"
      @click="page.back"
    >
      返回菜谱
    </wd-button>
  </view>
</template>
