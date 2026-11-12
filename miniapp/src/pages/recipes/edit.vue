<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { reactive, ref, watch } from 'vue';
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import type { RecipeInput } from 'home-contracts';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { editable, parseInput, validId, RecipeInputError, type FieldIssue } from '../../features/recipes/validation';
import { AppError, errorCode } from '../../shared/errors';
import { copy } from '../../shared/copy';
const { rootFontSize, singleColumn } = usePageTypography();

let sequence = 0;
const ingredient = () => ({ key: ++sequence, raw: '', name: '', quantity: '', unit: '', note: '' });
const step = () => ({ key: ++sequence, text: '' });
const draft = ref({ title: '', description: '', baseServings: '', prepMinutes: '', cookMinutes: '', ingredients: [ingredient()], steps: [step()], tags: '' });
const fields = reactive(useFieldIssues()); const form = ref<FormInstance>();
const aggregateIssue = ref(false);
const baseline = ref(JSON.stringify(draft.value));
const dirty = () => JSON.stringify(draft.value) !== baseline.value;
const id = ref<string | null>(null); let version = 1; let initializedScope = ''; let invalidId = false;
const page = useRecipesPage(initialize);
const { confirmed, busy, message, recipes, media } = page;
const { items: images, links: imageLinks, pending: pendingImages, canSave: canSaveImages } = media;
const { pending } = recipes;
const scope = () => { const view = page.family.view.value; return view ? view.uid + ':' + view.familyId + ':' + view.generation : ''; };
const leave = useLeaveGuard(dirty, () => (page.auth.phase.value === 'unavailable' || page.auth.identity.value?.uid === lastUid)
  && (page.family.phase.value !== 'ready' || !initializedScope || scope() === initializedScope), () => initializedScope);
let lastUid = page.auth.identity.value?.uid;
watch([page.auth.phase, () => page.auth.identity.value?.uid, page.family.phase, page.family.view], ([phase, uid, familyPhase, view]) => {
  const nextScope = view ? view.uid + ':' + view.familyId + ':' + view.generation : '';
  if (phase === 'anonymous' || phase === 'signing-out' || (uid && lastUid && uid !== lastUid)
    || (familyPhase === 'ready' && initializedScope && nextScope !== initializedScope)) {
    initializedScope = ''; id.value = null; version = 1; apply(blank());
  }
  if (uid) lastUid = uid;
}, { flush: 'sync' });
onUnload(() => { initializedScope = ''; apply(blank()); });
onLoad(query => { if (query?.id !== undefined) { try { id.value = validId(query.id); } catch { invalidId = true; } } });
function apply(input: RecipeInput) {
  draft.value = { title: input.title, description: input.description ?? '', baseServings: input.baseServings?.toString() ?? '',
    prepMinutes: input.prepMinutes?.toString() ?? '', cookMinutes: input.cookMinutes?.toString() ?? '', tags: input.tags.join('，'),
    ingredients: input.ingredients.map(row => ({ key: ++sequence, raw: row.raw, name: row.name, quantity: row.quantity?.toString() ?? '', unit: row.unit ?? '', note: row.note ?? '' })),
    steps: input.steps.map(text => ({ key: ++sequence, text })) };
  baseline.value = JSON.stringify(draft.value); fields.errors = {}; fields.focused = ''; aggregateIssue.value = false;
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
function fieldId(path: FieldIssue['path']): string {
  const [section, index, key] = path;
  if (section === 'ingredients' && typeof index === 'number') return 'ingredient-' + draft.value.ingredients[index]?.key + '-' + (key ?? 'raw');
  if (section === 'steps' && typeof index === 'number') return 'step-' + draft.value.steps[index]?.key;
  if (section === 'tags') return 'tags';
  return section === '_form' ? 'title' : String(section);
}
function issues(): FieldIssue[] {
  try { input(); return []; } catch (error) {
    return error instanceof RecipeInputError ? error.issues : [{ path: ['_form'], message: copy.invalidRecipe }];
  }
}
const schema: FormSchema = { validate: () => issues().map(issue => ({ ...issue, path: [fieldId(issue.path)] })) };
async function validateField(id: string) {
  const before = scope(); await form.value?.validate(id);
  if (!page.isCurrent() || before !== scope()) return;
  const issue = issues().find(issue => fieldId(issue.path) === id);
  if (issue) fields.errors[id] = issue.message; else fields.clear(id);
}
function changed(id: string) { fields.clear(id); if (aggregateIssue.value) { fields.clear('title'); aggregateIssue.value = false; } form.value?.reset(); }
async function removeRow(kind: 'ingredients' | 'steps', index: number) {
  const row = draft.value[kind][index];
  if (!row || !page.isCurrent() || busy.value || pending.value) return;
  const before = scope();
  if (Object.entries(row).some(([key, value]) => key !== 'key' && String(value).trim())) {
    const accepted = await leave.confirm({ title: kind === 'ingredients' ? '移除这项食材？' : '移除这一步骤？', content: '此行已填写的内容将丢失。', confirmText: '确认移除' }, true);
    leave.sync(); if (!accepted) return;
  }
  if (!page.isCurrent() || before !== scope() || busy.value || pending.value) return;
  index = draft.value[kind].findIndex(value => value.key === row.key);
  if (index < 0 || draft.value[kind].length <= 1) return;
  for (const key of Object.keys(fields.errors)) if (kind === 'ingredients' ? key.startsWith('ingredient-' + row.key + '-') : key === 'step-' + row.key) delete fields.errors[key];
  draft.value[kind].splice(index, 1); form.value?.reset(); leave.sync();
}
async function back() { if (await leave.confirm()) uni.switchTab({ url: '/pages/recipes/index', fail: leave.sync }); }
async function save(resume = false) {
  await page.act(async isCurrent => {
    let value: RecipeInput;
    try {
      if (!pending.value) {
        await form.value?.validate(); if (!isCurrent()) return; const found = issues(); fields.set(found, fieldId); aggregateIssue.value = found.some(issue => issue.path[0] === '_form');
        if (found.length) { message.value = '请检查标出的字段。'; await fields.reveal(); return; }
      }
      value = pending.value ? pending.value.input.recipe as RecipeInput : input();
    } catch { message.value = copy.invalidRecipe; return; }
    const result = resume ? await recipes.retry() : await recipes.submit(value, id.value ? { id: id.value, version } : undefined);
    if (!isCurrent()) return;
    id.value = result.id; version = result.version; baseline.value = JSON.stringify(draft.value); leave.disable();
    uni.redirectTo({ url: '/pages/recipes/detail?id=' + result.id });
  });
}
async function reload() {
  await page.act(async isCurrent => {
    const accepted = await leave.confirm({ title: copy.reloadRecipe, content: copy.reloadRecipeConfirm, confirmText: '重新加载' }, true);
    if (!accepted || !isCurrent() || !id.value || pending.value) return;
    try {
      const value = await recipes.get(id.value);
      if (value && isCurrent()) { apply(editable(value)); version = value.version; await media.initialize(value, true); }
    } finally { leave.sync(); }
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
  <page-meta :root-font-size="rootFontSize" />
  <view class="page editor-page">
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
        {{ id ? copy.editRecipe : copy.createRecipe }}
      </text>
      <view
        v-if="pending"
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <text>{{ copy.pendingRecipe }}</text>
        <HomeAction
          :label="copy.resumeRecipe"
          type="primary"
          data-resume
          :disabled="busy || !!pendingImages"
          :loading="busy"
          @click="save(true)"
        >
          {{ copy.resumeRecipe }}
        </HomeAction>
      </view>
      <wd-form
        ref="form"
        :model="draft"
        :schema="schema"
        error-type="none"
        :disabled="busy || !!pending"
        custom-class="form"
        :reset-on-change="false"
      >
        <view class="form-section">
          <text
            class="section"
            role="heading"
            aria-role="heading"
            aria-level="2"
          >
            基本信息
          </text>
          <wd-form-item
            :prop="'title'"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text class="field-label">
              {{ copy.recipeTitle }}
            </text>
            <input
              :id="'title'"
              class="home-input"
              data-title
              :value="draft.title"
              :maxlength="240"
              :aria-label="copy.recipeTitle"
              :aria-invalid="!!fields.errors['title']"
              :aria-describedby="fields.errors['title'] ? 'title' + '-error' : undefined"
              :focus="fields.focused === 'title'"
              :disabled="busy || !!pending"
              placeholder-style="color: var(--home-muted); opacity: 1"
              :cursor-spacing="32"
              :placeholder="copy.recipeTitle"
              @input="draft.title = $event.detail.value; changed('title')"
              @blur="validateField('title')"
            >
            <text
              v-if="fields.errors['title']"
              :id="'title' + '-error'"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors['title'] }}
            </text>
          </wd-form-item>
          <wd-form-item
            :prop="'description'"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text class="field-label">
              {{ copy.recipeDescription }}
            </text>
            <textarea
              :id="'description'"
              auto-height
              class="home-textarea"
              data-description
              :value="draft.description"
              :maxlength="4000"
              :aria-label="copy.recipeDescription"
              :aria-invalid="!!fields.errors['description']"
              :aria-describedby="fields.errors['description'] ? 'description' + '-error' : undefined"
              :focus="fields.focused === 'description'"
              :disabled="busy || !!pending"
              placeholder-style="color: var(--home-muted); opacity: 1"
              :cursor-spacing="32"
              :placeholder="copy.recipeDescription"
              @input="draft.description = $event.detail.value; changed('description')"
              @blur="validateField('description')"
            />
            <text
              v-if="fields.errors['description']"
              :id="'description' + '-error'"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors['description'] }}
            </text>
          </wd-form-item>
          <view
            class="field-grid"
            :class="{ 'is-single-column': singleColumn }"
          >
            <wd-form-item
              :prop="'baseServings'"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ copy.servings }}
              </text>
              <input
                :id="'baseServings'"
                type="digit"
                class="home-input"
                data-servings
                :value="draft.baseServings"
                :aria-label="copy.servings"
                :aria-invalid="!!fields.errors['baseServings']"
                :aria-describedby="fields.errors['baseServings'] ? 'baseServings' + '-error' : undefined"
                :focus="fields.focused === 'baseServings'"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="copy.servings + '，可留空'"
                @input="draft.baseServings = $event.detail.value; changed('baseServings')"
                @blur="validateField('baseServings')"
              >
              <text
                v-if="fields.errors['baseServings']"
                :id="'baseServings' + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['baseServings'] }}
              </text>
            </wd-form-item><wd-form-item
              :prop="'prepMinutes'"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ copy.prepMinutes }}
              </text>
              <input
                :id="'prepMinutes'"
                type="digit"
                class="home-input"
                data-prep
                :value="draft.prepMinutes"
                :aria-label="copy.prepMinutes"
                :aria-invalid="!!fields.errors['prepMinutes']"
                :aria-describedby="fields.errors['prepMinutes'] ? 'prepMinutes' + '-error' : undefined"
                :focus="fields.focused === 'prepMinutes'"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="copy.prepMinutes + '，可留空'"
                @input="draft.prepMinutes = $event.detail.value; changed('prepMinutes')"
                @blur="validateField('prepMinutes')"
              >
              <text
                v-if="fields.errors['prepMinutes']"
                :id="'prepMinutes' + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['prepMinutes'] }}
              </text>
            </wd-form-item><wd-form-item
              :prop="'cookMinutes'"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ copy.cookMinutes }}
              </text>
              <input
                :id="'cookMinutes'"
                type="digit"
                class="home-input"
                data-cook
                :value="draft.cookMinutes"
                :aria-label="copy.cookMinutes"
                :aria-invalid="!!fields.errors['cookMinutes']"
                :aria-describedby="fields.errors['cookMinutes'] ? 'cookMinutes' + '-error' : undefined"
                :focus="fields.focused === 'cookMinutes'"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="copy.cookMinutes + '，可留空'"
                @input="draft.cookMinutes = $event.detail.value; changed('cookMinutes')"
                @blur="validateField('cookMinutes')"
              >
              <text
                v-if="fields.errors['cookMinutes']"
                :id="'cookMinutes' + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['cookMinutes'] }}
              </text>
            </wd-form-item>
          </view>
        </view>
        <view class="form-section">
          <text
            class="section"
            role="heading"
            aria-role="heading"
            aria-level="2"
          >
            {{ copy.ingredients }}
          </text>
          <view
            v-for="(row, index) in draft.ingredients"
            :key="row.key"
            class="row"
            data-ingredient
          >
            <text class="row-title">
              {{ copy.ingredients }} {{ index + 1 }}
            </text>
            <wd-form-item
              :prop="'ingredient-' + row.key + '-raw'"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ copy.ingredientRaw }}
              </text>
              <input
                :id="'ingredient-' + row.key + '-raw'"
                class="home-input"
                data-raw
                :value="row.raw"
                :maxlength="1000"
                :aria-label="'食材 ' + (index + 1) + ' 原文'"
                :aria-invalid="!!fields.errors['ingredient-' + row.key + '-raw']"
                :aria-describedby="fields.errors['ingredient-' + row.key + '-raw'] ? 'ingredient-' + row.key + '-raw' + '-error' : undefined"
                :focus="fields.focused === 'ingredient-' + row.key + '-raw'"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="copy.ingredientRaw"
                @input="row.raw = $event.detail.value; changed('ingredient-' + row.key + '-raw')"
                @blur="validateField('ingredient-' + row.key + '-raw')"
              >
              <text
                v-if="fields.errors['ingredient-' + row.key + '-raw']"
                :id="'ingredient-' + row.key + '-raw' + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['ingredient-' + row.key + '-raw'] }}
              </text>
            </wd-form-item>
            <wd-form-item
              :prop="'ingredient-' + row.key + '-name'"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ copy.ingredientName }}
              </text>
              <input
                :id="'ingredient-' + row.key + '-name'"
                class="home-input"
                data-name
                :value="row.name"
                :maxlength="200"
                :aria-label="'食材 ' + (index + 1) + ' 名称'"
                :aria-invalid="!!fields.errors['ingredient-' + row.key + '-name']"
                :aria-describedby="fields.errors['ingredient-' + row.key + '-name'] ? 'ingredient-' + row.key + '-name' + '-error' : undefined"
                :focus="fields.focused === 'ingredient-' + row.key + '-name'"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="copy.ingredientName"
                @input="row.name = $event.detail.value; changed('ingredient-' + row.key + '-name')"
                @blur="validateField('ingredient-' + row.key + '-name')"
              >
              <text
                v-if="fields.errors['ingredient-' + row.key + '-name']"
                :id="'ingredient-' + row.key + '-name' + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['ingredient-' + row.key + '-name'] }}
              </text>
            </wd-form-item>
            <view
              class="field-grid"
              :class="{ 'is-single-column': singleColumn }"
            >
              <wd-form-item
                :prop="'ingredient-' + row.key + '-quantity'"
                layout="vertical"
                custom-class="home-form-item"
              >
                <text class="field-label">
                  {{ copy.quantity }}
                </text>
                <input
                  :id="'ingredient-' + row.key + '-quantity'"
                  type="digit"
                  class="home-input"
                  data-quantity
                  :value="row.quantity"
                  :aria-label="'食材 ' + (index + 1) + ' 数量，留空表示未注明'"
                  :aria-invalid="!!fields.errors['ingredient-' + row.key + '-quantity']"
                  :aria-describedby="fields.errors['ingredient-' + row.key + '-quantity'] ? 'ingredient-' + row.key + '-quantity' + '-error' : undefined"
                  :focus="fields.focused === 'ingredient-' + row.key + '-quantity'"
                  :disabled="busy || !!pending"
                  placeholder-style="color: var(--home-muted); opacity: 1"
                  :cursor-spacing="32"
                  :placeholder="'数量，未注明请留空'"
                  @input="row.quantity = $event.detail.value; changed('ingredient-' + row.key + '-quantity')"
                  @blur="validateField('ingredient-' + row.key + '-quantity')"
                >
                <text
                  v-if="fields.errors['ingredient-' + row.key + '-quantity']"
                  :id="'ingredient-' + row.key + '-quantity' + '-error'"
                  class="field-error"
                  role="alert"
                  aria-role="alert"
                >
                  {{ fields.errors['ingredient-' + row.key + '-quantity'] }}
                </text>
              </wd-form-item><wd-form-item
                :prop="'ingredient-' + row.key + '-unit'"
                layout="vertical"
                custom-class="home-form-item"
              >
                <text class="field-label">
                  {{ copy.unit }}
                </text>
                <input
                  :id="'ingredient-' + row.key + '-unit'"
                  class="home-input"
                  data-unit
                  :value="row.unit"
                  :maxlength="80"
                  :aria-label="'食材 ' + (index + 1) + ' 单位'"
                  :aria-invalid="!!fields.errors['ingredient-' + row.key + '-unit']"
                  :aria-describedby="fields.errors['ingredient-' + row.key + '-unit'] ? 'ingredient-' + row.key + '-unit' + '-error' : undefined"
                  :focus="fields.focused === 'ingredient-' + row.key + '-unit'"
                  :disabled="busy || !!pending"
                  placeholder-style="color: var(--home-muted); opacity: 1"
                  :cursor-spacing="32"
                  :placeholder="copy.unit"
                  @input="row.unit = $event.detail.value; changed('ingredient-' + row.key + '-unit')"
                  @blur="validateField('ingredient-' + row.key + '-unit')"
                >
                <text
                  v-if="fields.errors['ingredient-' + row.key + '-unit']"
                  :id="'ingredient-' + row.key + '-unit' + '-error'"
                  class="field-error"
                  role="alert"
                  aria-role="alert"
                >
                  {{ fields.errors['ingredient-' + row.key + '-unit'] }}
                </text>
              </wd-form-item>
            </view>
            <wd-form-item
              :prop="'ingredient-' + row.key + '-note'"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ copy.note }}
              </text>
              <textarea
                :id="'ingredient-' + row.key + '-note'"
                auto-height
                class="home-textarea"
                data-note
                :value="row.note"
                :maxlength="1000"
                :aria-label="'食材 ' + (index + 1) + ' 备注'"
                :aria-invalid="!!fields.errors['ingredient-' + row.key + '-note']"
                :aria-describedby="fields.errors['ingredient-' + row.key + '-note'] ? 'ingredient-' + row.key + '-note' + '-error' : undefined"
                :focus="fields.focused === 'ingredient-' + row.key + '-note'"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="copy.note"
                @input="row.note = $event.detail.value; changed('ingredient-' + row.key + '-note')"
                @blur="validateField('ingredient-' + row.key + '-note')"
              />
              <text
                v-if="fields.errors['ingredient-' + row.key + '-note']"
                :id="'ingredient-' + row.key + '-note' + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['ingredient-' + row.key + '-note'] }}
              </text>
            </wd-form-item>
            <HomeAction
              :label="'移除食材 ' + (index + 1)"
              type="danger"
              variant="text"
              data-remove-ingredient
              :disabled="busy || !!pending || draft.ingredients.length === 1"
              @click="removeRow('ingredients', index)"
            >
              {{ copy.removeRow }}
            </HomeAction>
          </view>
          <HomeAction
            :label="copy.addIngredient"
            type="info"
            variant="text"
            data-add-ingredient
            :disabled="busy || !!pending || draft.ingredients.length >= 100"
            @click="draft.ingredients.push(ingredient())"
          >
            {{ copy.addIngredient }}
          </HomeAction>
          <text
            v-if="fields.errors.ingredients"
            class="field-error"
            role="alert"
            aria-role="alert"
          >
            {{ fields.errors.ingredients }}
          </text>
        </view>
        <view class="form-section">
          <text
            class="section"
            role="heading"
            aria-role="heading"
            aria-level="2"
          >
            {{ copy.steps }}
          </text>
          <view
            v-for="(row, index) in draft.steps"
            :key="row.key"
            class="row"
          >
            <wd-form-item
              :prop="'step-' + row.key"
              layout="vertical"
              custom-class="home-form-item"
            >
              <text class="field-label">
                {{ '步骤 ' + (index + 1) }}
              </text>
              <textarea
                :id="'step-' + row.key"
                auto-height
                class="home-textarea"
                data-step
                :value="row.text"
                :maxlength="4000"
                :aria-label="'步骤 ' + (index + 1)"
                :aria-invalid="!!fields.errors['step-' + row.key]"
                :aria-describedby="fields.errors['step-' + row.key] ? 'step-' + row.key + '-error' : undefined"
                :focus="fields.focused === 'step-' + row.key"
                :disabled="busy || !!pending"
                placeholder-style="color: var(--home-muted); opacity: 1"
                :cursor-spacing="32"
                :placeholder="'步骤 ' + (index + 1)"
                @input="row.text = $event.detail.value; changed('step-' + row.key)"
                @blur="validateField('step-' + row.key)"
              />
              <text
                v-if="fields.errors['step-' + row.key]"
                :id="'step-' + row.key + '-error'"
                class="field-error"
                role="alert"
                aria-role="alert"
              >
                {{ fields.errors['step-' + row.key] }}
              </text>
            </wd-form-item>
            <HomeAction
              :label="'移除步骤 ' + (index + 1)"
              type="danger"
              variant="text"
              data-remove-step
              :disabled="busy || !!pending || draft.steps.length === 1"
              @click="removeRow('steps', index)"
            >
              {{ copy.removeRow }}
            </HomeAction>
          </view>
          <HomeAction
            :label="copy.addStep"
            type="info"
            variant="text"
            data-add-step
            :disabled="busy || !!pending || draft.steps.length >= 50"
            @click="draft.steps.push(step())"
          >
            {{ copy.addStep }}
          </HomeAction>
          <text
            v-if="fields.errors.steps"
            class="field-error"
            role="alert"
            aria-role="alert"
          >
            {{ fields.errors.steps }}
          </text>
        </view>
        <view class="form-section">
          <text
            class="section"
            role="heading"
            aria-role="heading"
            aria-level="2"
          >
            标签
          </text>
          <wd-form-item
            :prop="'tags'"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text class="field-label">
              {{ copy.tags }}
            </text>
            <input
              :id="'tags'"
              class="home-input"
              data-tags
              :value="draft.tags"
              :maxlength="1640"
              :aria-label="copy.tags"
              :aria-invalid="!!fields.errors['tags']"
              :aria-describedby="fields.errors['tags'] ? 'tags' + '-error' : undefined"
              :focus="fields.focused === 'tags'"
              :disabled="busy || !!pending"
              placeholder-style="color: var(--home-muted); opacity: 1"
              :cursor-spacing="32"
              :placeholder="copy.tags"
              @input="draft.tags = $event.detail.value; changed('tags')"
              @blur="validateField('tags')"
            >
            <text
              v-if="fields.errors['tags']"
              :id="'tags' + '-error'"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors['tags'] }}
            </text>
          </wd-form-item>
        </view>
        <HomeAction
          v-if="!pending"
          :label="copy.saveRecipe"
          type="primary"
          data-save
          :disabled="busy || !!pendingImages"
          :loading="busy"
          @click="save()"
        >
          {{ copy.saveRecipe }}
        </HomeAction>
        <HomeAction
          v-if="id && !pending"
          :label="copy.reloadRecipe"
          type="info"
          variant="text"
          data-reload
          :disabled="busy"
          @click="reload"
        >
          {{ copy.reloadRecipe }}
        </HomeAction>
      </wd-form>
      <view
        class="form-section"
        data-images
      >
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
              aria-role="button"
              @tap="page.act(async () => { await media.preview(image.mediaId); })"
            />
            <text
              role="status"
              aria-role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {{ imageState[image.state] }}{{ image.review === 'mock' ? '（模拟审核）' : '' }}
            </text>
            <HomeAction
              v-if="image.retryable"
              label="重试图片处理"
              type="info"
              data-retry-image
              :disabled="busy || !!pendingImages"
              @click="page.act(async () => { await media.retry(image.mediaId); })"
            >
              重试图片处理
            </HomeAction>
            <HomeAction
              label="移除图片"
              type="danger"
              variant="text"
              data-remove-image
              :disabled="busy || !!pendingImages"
              @click="media.remove(image.mediaId)"
            >
              移除图片
            </HomeAction>
          </view>
          <HomeAction
            label="选择图片"
            type="info"
            data-choose-image
            :disabled="busy || !!pending || !!pendingImages || images.length >= 20"
            @click="chooseImage"
          >
            选择图片
          </HomeAction>
          <HomeAction
            label="刷新图片状态"
            type="info"
            data-refresh-images
            :disabled="busy"
            @click="page.act(async () => { await media.refresh(); })"
          >
            刷新图片状态
          </HomeAction>
          <HomeAction
            :label="pendingImages ? '恢复原图片保存请求' : '保存图片'"
            type="info"
            data-save-images
            :disabled="busy || !!pending || !canSaveImages"
            @click="saveImages"
          >
            {{ pendingImages ? '恢复原图片保存请求' : '保存图片' }}
          </HomeAction>
          <text
            v-if="pendingImages"
            role="status"
            aria-role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            上次保存结果未知，请恢复原请求后继续编辑。
          </text>
        </view>
      </view>
    </view>
    <text
      v-else
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ message || copy.checking }}
    </text>
    <text
      v-if="confirmed && message"
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ message }}
    </text>
    <HomeAction
      v-if="message"
      :label="copy.retry"
      type="info"
      variant="text"
      data-check
      @click="page.check"
    >
      {{ copy.retry }}
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
