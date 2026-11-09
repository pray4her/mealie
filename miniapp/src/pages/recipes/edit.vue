<script setup lang="ts">
import { ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import type { RecipeInput } from 'home-contracts';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { editable, parseInput, validId } from '../../features/recipes/validation';
import { AppError } from '../../shared/errors';
import { copy } from '../../shared/copy';

let sequence = 0;
const ingredient = () => ({ key: ++sequence, raw: '', name: '', quantity: '', unit: '', note: '' });
const step = () => ({ key: ++sequence, text: '' });
const draft = ref({ title: '', description: '', baseServings: '', prepMinutes: '', cookMinutes: '', ingredients: [ingredient()], steps: [step()], tags: '' });
const id = ref<string | null>(null); let version = 1; let initializedScope = ''; let invalidId = false;
const page = useRecipesPage(initialize);
const { confirmed, busy, message, recipes } = page;
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
  if (initializedScope === scope) return;
  const intent = recipes.restore();
  if (intent) {
    id.value = intent.kind === 'update' ? intent.input.id : null;
    version = intent.kind === 'update' ? intent.input.version : 1; apply(intent.input.recipe);
  } else if (id.value) {
    const value = await recipes.get(id.value); if (!value) return;
    version = value.version; apply(editable(value));
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
    if (value && isCurrent()) { apply(editable(value)); version = value.version; }
  });
}
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
      <view
        v-if="pending"
        role="status"
      >
        <text>{{ copy.pendingRecipe }}</text>
        <button
          data-resume
          :disabled="busy"
          :loading="busy"
          @tap="save(true)"
        >
          {{ copy.resumeRecipe }}
        </button>
      </view>
      <view class="form">
        <text>{{ copy.recipeTitle }}</text>
        <input
          data-title
          :value="draft.title"
          :maxlength="240"
          :disabled="busy || !!pending"
          :placeholder="copy.recipeTitle"
          @input="draft.title = $event.detail.value"
        >
        <text>{{ copy.recipeDescription }}</text>
        <textarea
          data-description
          :value="draft.description"
          :maxlength="4000"
          :disabled="busy || !!pending"
          :placeholder="copy.recipeDescription"
          @input="draft.description = $event.detail.value"
        />
        <text>{{ copy.servings }}</text>
        <input
          data-servings
          type="digit"
          :value="draft.baseServings"
          :disabled="busy || !!pending"
          @input="draft.baseServings = $event.detail.value"
        >
        <text>{{ copy.prepMinutes }}</text>
        <input
          data-prep
          type="digit"
          :value="draft.prepMinutes"
          :disabled="busy || !!pending"
          @input="draft.prepMinutes = $event.detail.value"
        >
        <text>{{ copy.cookMinutes }}</text>
        <input
          data-cook
          type="digit"
          :value="draft.cookMinutes"
          :disabled="busy || !!pending"
          @input="draft.cookMinutes = $event.detail.value"
        >
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
          <input
            data-raw
            :value="row.raw"
            :maxlength="1000"
            :disabled="busy || !!pending"
            :placeholder="copy.ingredientRaw"
            @input="row.raw = $event.detail.value"
          >
          <input
            data-name
            :value="row.name"
            :maxlength="200"
            :disabled="busy || !!pending"
            :placeholder="copy.ingredientName"
            @input="row.name = $event.detail.value"
          >
          <input
            data-quantity
            type="digit"
            :value="row.quantity"
            :disabled="busy || !!pending"
            :placeholder="copy.quantity"
            @input="row.quantity = $event.detail.value"
          >
          <input
            data-unit
            :value="row.unit"
            :maxlength="80"
            :disabled="busy || !!pending"
            :placeholder="copy.unit"
            @input="row.unit = $event.detail.value"
          >
          <textarea
            data-note
            :value="row.note"
            :maxlength="1000"
            :disabled="busy || !!pending"
            :placeholder="copy.note"
            @input="row.note = $event.detail.value"
          />
          <button
            data-remove-ingredient
            :disabled="busy || !!pending || draft.ingredients.length === 1"
            @tap="draft.ingredients.splice(index, 1)"
          >
            {{ copy.removeRow }}
          </button>
        </view>
        <button
          data-add-ingredient
          :disabled="busy || !!pending || draft.ingredients.length >= 100"
          @tap="draft.ingredients.push(ingredient())"
        >
          {{ copy.addIngredient }}
        </button>
        <text class="section">
          {{ copy.steps }}
        </text>
        <view
          v-for="(row, index) in draft.steps"
          :key="row.key"
          class="row"
        >
          <text>{{ copy.steps }} {{ index + 1 }}</text>
          <textarea
            data-step
            :value="row.text"
            :maxlength="4000"
            :disabled="busy || !!pending"
            :placeholder="copy.step"
            @input="row.text = $event.detail.value"
          />
          <button
            data-remove-step
            :disabled="busy || !!pending || draft.steps.length === 1"
            @tap="draft.steps.splice(index, 1)"
          >
            {{ copy.removeRow }}
          </button>
        </view>
        <button
          data-add-step
          :disabled="busy || !!pending || draft.steps.length >= 50"
          @tap="draft.steps.push(step())"
        >
          {{ copy.addStep }}
        </button>
        <text>{{ copy.tags }}</text>
        <input
          data-tags
          :value="draft.tags"
          :maxlength="1640"
          :disabled="busy || !!pending"
          :placeholder="copy.tags"
          @input="draft.tags = $event.detail.value"
        >
        <button
          v-if="!pending"
          data-save
          :disabled="busy"
          :loading="busy"
          @tap="save()"
        >
          {{ copy.saveRecipe }}
        </button>
        <button
          v-if="id && !pending"
          data-reload
          :disabled="busy"
          @tap="reload"
        >
          {{ copy.reloadRecipe }}
        </button>
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
    <button
      v-if="message"
      data-check
      @tap="page.check"
    >
      {{ copy.retry }}
    </button>
    <button @tap="page.back">
      {{ copy.backHome }}
    </button>
  </view>
</template>
<style scoped>
.page { padding: 40rpx; }
.title { display: block; font-size: 40rpx; margin-bottom: 24rpx; }
.form > text, .section { display: block; margin-top: 24rpx; }
.row { margin-top: 24rpx; padding: 24rpx; background: white; border-radius: 16rpx; }
input, textarea { box-sizing: border-box; width: 100%; min-height: 80rpx; margin-top: 16rpx; padding: 16rpx; background: white; border: 1rpx solid #76766d; border-radius: 8rpx; }
textarea { height: 180rpx; }
button { margin-top: 24rpx; }
</style>
