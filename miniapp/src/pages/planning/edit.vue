<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app';
import WdForm from '@wot-ui/ui/components/wd-form/wd-form.vue';
import WdFormItem from '@wot-ui/ui/components/wd-form-item/wd-form-item.vue';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import type { MealType, PlanEntry, Recipe } from 'home-contracts';
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
import { usePlanningPage } from '../../features/planning/use-planning-page';
import type { PlanAcknowledgement } from '../../features/planning/use-planning';
import { beijingToday, parseLocalDate } from '../../features/planning/dates';
import { parseMeal, parseServingsText } from '../../features/planning/validation';
import { validId, type FieldIssue } from '../../features/recipes/validation';
import { errorCode } from '../../shared/errors';
import { copy } from '../../shared/copy';

const { rootFontSize } = usePageTypography();
const blank = () => ({ date: beijingToday(Date.now()), meal: 'dinner' as MealType, targetServings: '' });
const draft = ref(blank()); const baseline = ref(JSON.stringify(draft.value)); const fields = reactive(useFieldIssues()); const form = ref<FormInstance>();
const id = ref<string | null>(null); const recipeId = ref<string | null>(null); const title = ref(''); const sourceAvailable = ref(true);
const stage = ref<'search' | 'form'>('search'); const query = ref(''); const searchReady = ref(false); const loading = ref(false); const ready = ref(false);
const invalidQuery = ref(false); const committed = ref<PlanAcknowledgement | null>(null); const refreshFailed = ref(false);
let version = 1; let initializedScope: string | null = null; let attemptId: string | null = null; let visibility = 0;
let savedMeal: { date: string; meal: MealType } | null = null;
const page = usePlanningPage(initialize);
const { planning, confirmed, busy, message, draftScope } = page;
const { pending, searchItems, searchCursor, writing } = planning;
const locked = computed(() => busy.value || loading.value || writing.value || !!pending.value || !!committed.value);
const dirty = () => !committed.value && JSON.stringify(draft.value) !== baseline.value;
const leave = useLeaveGuard(dirty, () => page.isCurrent(), () => draftScope.value ?? '');
const meals: { key: MealType; title: string }[] = [{ key: 'breakfast', title: '早餐' }, { key: 'lunch', title: '午餐' }, { key: 'dinner', title: '晚餐' }, { key: 'other', title: '其他' }];
const mealTitle = (meal: MealType) => meals.find(value => value.key === meal)!.title;
function currentAction() {
  const current = visibility; const scope = draftScope.value;
  return () => current === visibility && scope === draftScope.value && page.isCurrent();
}
function apply(value: { date: string; meal: MealType; targetServings: number | null }) {
  draft.value = { date: value.date, meal: value.meal, targetServings: value.targetServings?.toString() ?? '' };
  baseline.value = JSON.stringify(draft.value); fields.errors = {}; fields.focused = ''; form.value?.reset();
}
function clear() {
  visibility++; initializedScope = null; attemptId = null; savedMeal = null; id.value = null; recipeId.value = null; title.value = ''; version = 1;
  sourceAvailable.value = true; stage.value = 'search'; query.value = ''; searchReady.value = false; loading.value = false; ready.value = false;
  invalidQuery.value = false; committed.value = null; refreshFailed.value = false; draft.value = blank(); baseline.value = JSON.stringify(draft.value); fields.errors = {}; fields.focused = '';
}
watch(draftScope, value => { if (initializedScope && value !== initializedScope) clear(); }, { flush: 'sync' });
onHide(() => { visibility++; loading.value = false; }); onUnload(clear);
onLoad(params => {
  try {
    if (params?.id !== undefined && params?.recipeId !== undefined) throw new Error();
    if (params?.id !== undefined) { id.value = validId(params.id); stage.value = 'form'; }
    if (params?.recipeId !== undefined) recipeId.value = validId(params.recipeId);
    if (params?.date !== undefined) draft.value.date = parseLocalDate(params.date);
    if (params?.meal !== undefined) draft.value.meal = parseMeal(params.meal);
    baseline.value = JSON.stringify(draft.value);
  } catch { invalidQuery.value = true; }
});
function acknowledge(ack: PlanAcknowledgement | null) {
  if (!ack || !attemptId || ack.requestId !== attemptId || !page.isCurrent()) return;
  committed.value = { ...ack }; baseline.value = JSON.stringify(draft.value); leave.disable();
  // Preserve the return date before a post-acknowledgement read can fail or be interrupted.
  planning.selectDate(ack.kind === 'remove' && savedMeal ? savedMeal.date : draft.value.date);
}
watch(planning.confirmed, acknowledge, { flush: 'sync' });
function applyEntry(row: PlanEntry, keepVersion = false) {
  savedMeal = { date: row.date, meal: row.meal };
  id.value = row.id; recipeId.value = row.recipeId; title.value = row.titleSnapshot; sourceAvailable.value = row.sourceAvailable;
  if (!keepVersion) { version = row.version; apply(row); }
  stage.value = 'form'; ready.value = true;
}
function applyRecipe(row: Recipe) {
  recipeId.value = row.id; title.value = row.title; sourceAvailable.value = true;
  apply({ ...draft.value, targetServings: row.baseServings }); stage.value = 'form'; ready.value = true;
}
async function search(more = false) {
  const isCurrent = currentAction(); loading.value = true; if (!more) searchReady.value = false;
  try { await planning.search(query.value, more); if (isCurrent()) searchReady.value = true; }
  finally { if (isCurrent()) loading.value = false; }
}
async function refreshCommitted() {
  const ack = committed.value; if (!ack) return;
  const isCurrent = currentAction(); loading.value = true;
  try {
    if (ack.kind !== 'remove') await planning.get(ack.id);
    if (!isCurrent()) return;
    await planning.list(); if (isCurrent()) refreshFailed.value = false;
  } catch (error) { if (isCurrent()) refreshFailed.value = true; throw error; }
  finally { if (isCurrent()) loading.value = false; }
}
async function initialize() {
  const isCurrent = currentAction();
  if (invalidQuery.value) { initializedScope = draftScope.value; message.value = '安排参数无效，请返回计划重新选择。'; return; }
  acknowledge(planning.confirmed.value);
  if (initializedScope === draftScope.value) {
    if (committed.value) { await refreshCommitted(); return; }
    if (ready.value) return;
    if (!id.value && !recipeId.value) { await search(); return; }
  }
  initializedScope = draftScope.value; loading.value = true;
  try {
    const intent = pending.value;
    if (intent) {
      attemptId = intent.input.requestId; stage.value = 'form'; ready.value = true;
      id.value = intent.kind === 'add' ? null : intent.input.id;
      if (intent.kind !== 'add') version = intent.input.version;
      if (intent.kind !== 'remove') apply(intent.input);
      if (intent.kind === 'add') recipeId.value = intent.input.recipeId;
      try {
        if (id.value) {
          const row = await planning.get(id.value); if (!isCurrent()) return;
          if (row) { applyEntry(row, true); if (intent.kind === 'remove') apply(row); }
        } else {
          const row = await planning.selectRecipe(recipeId.value!); if (!isCurrent()) return;
          if (row) title.value = row.title;
        }
      } catch (error) {
        if (!isCurrent()) throw error;
        if (['AUTH_REQUIRED', 'FORBIDDEN', 'FAMILY_REQUIRED'].includes(errorCode(error))) throw error;
        sourceAvailable.value = false; message.value = '原请求仍待确认，当前来源无法读取；可以恢复原请求。';
      }
    } else if (id.value) {
      const row = await planning.get(id.value); if (row && isCurrent()) applyEntry(row);
    } else if (recipeId.value) {
      const row = await planning.selectRecipe(recipeId.value); if (row && isCurrent()) applyRecipe(row);
    } else await search();
  } finally { if (isCurrent()) loading.value = false; }
}
function issues(): FieldIssue[] {
  const result: FieldIssue[] = [];
  try { parseLocalDate(draft.value.date); } catch { result.push({ path: ['date'], message: '请选择有效日期（0001-01-01 至 9999-12-31）。' }); }
  try { parseMeal(draft.value.meal); } catch { result.push({ path: ['meal'], message: '请选择早餐、午餐、晚餐或其他。' }); }
  try { parseServingsText(draft.value.targetServings); } catch { result.push({ path: ['targetServings'], message: '份数可留空，或填写大于 0 且不超过 10000 的数字。' }); }
  return result;
}
const schema: FormSchema = { validate: () => issues() };
function changeDate(value: string) { if (page.isCurrent() && !locked.value) { draft.value.date = value; fields.clear('date'); form.value?.reset(); } }
function changeMeal(value: MealType) { if (page.isCurrent() && !locked.value) { draft.value.meal = value; fields.clear('meal'); form.value?.reset(); } }
function changeServings(value: string) { if (page.isCurrent() && !locked.value) { draft.value.targetServings = value; fields.clear('targetServings'); form.value?.reset(); } }
async function validateField(key: string) {
  const isCurrent = currentAction(); await form.value?.validate(key); if (!isCurrent()) return;
  const issue = issues().find(item => item.path[0] === key); if (issue) fields.errors[key] = issue.message; else fields.clear(key);
}
async function choose(target: string) {
  await page.act(async isCurrent => {
    if (pending.value || committed.value) return;
    const row = await planning.selectRecipe(target); if (row && isCurrent()) applyRecipe(row);
  });
}
async function changeRecipe() {
  await page.act(async isCurrent => {
    if (id.value || pending.value || committed.value) return;
    const accepted = await leave.confirm({ title: '更换菜谱？', content: '当前未保存的安排输入将丢失。', confirmText: '更换菜谱' });
    if (!accepted || !isCurrent()) return;
    recipeId.value = null; title.value = ''; ready.value = false; stage.value = 'search';
    apply({ ...draft.value, targetServings: null }); await search(); if (isCurrent()) leave.sync();
  });
}
async function write(kind: 'save' | 'remove' | 'retry') {
  await page.act(async isCurrent => {
    if (committed.value || writing.value || (pending.value && kind !== 'retry')) return;
    if (kind === 'save') {
      if (!ready.value || !recipeId.value) return;
      await form.value?.validate(); if (!isCurrent()) return;
      const found = issues(); fields.set(found, path => String(path[0]));
      if (found.length) { message.value = '请检查标出的字段。'; await fields.reveal(); return; }
    }
    if (kind === 'remove') {
      if (!id.value) return;
      const accepted = await leave.confirm({ title: '移除这项安排？', content: (savedMeal?.date ?? draft.value.date) + ' · ' + mealTitle(savedMeal?.meal ?? draft.value.meal) + ' · ' + title.value + '。移除后不可撤销，未保存的输入将丢失。', confirmText: '确认移除' }, true);
      if (!accepted || !isCurrent()) return;
    }
    if (kind !== 'retry') attemptId = null;
    // Capture only this form's request; a prior controller acknowledgement cannot commit a fresh add.
    const stop = watch(pending, intent => { if (intent && isCurrent()) attemptId = intent.input.requestId; }, { flush: 'sync' });
    try {
      const input = () => ({ date: parseLocalDate(draft.value.date), meal: parseMeal(draft.value.meal), targetServings: parseServingsText(draft.value.targetServings) });
      const ack = kind === 'retry' ? await planning.retry() : kind === 'remove' ? await planning.remove({ id: id.value!, version })
        : id.value ? await planning.update({ ...input(), id: id.value, version }) : await planning.add({ ...input(), recipeId: recipeId.value! });
      if (!isCurrent()) return;
      acknowledge(ack); refreshFailed.value = !!planning.readError.value;
    } finally { stop(); if (isCurrent()) leave.sync(); }
  });
}
async function reload() {
  await page.act(async isCurrent => {
    if (!id.value || pending.value || committed.value) return;
    const accepted = await leave.confirm({ title: '重新加载安排？', content: '重新加载会丢弃未保存的输入，并使用最新版本。', confirmText: '重新加载' }, true);
    if (!accepted || !isCurrent()) return;
    try { const row = await planning.get(id.value); if (row && isCurrent()) applyEntry(row); }
    finally { if (isCurrent()) leave.sync(); }
  });
}
async function back() {
  const isCurrent = currentAction(); const accepted = await leave.confirm();
  if (accepted && isCurrent()) page.back();
}
function retryRead() { return committed.value ? page.act(refreshCommitted) : stage.value === 'search' && !recipeId.value && !id.value ? page.act(() => search()) : page.check(); }
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page editor-page planning-editor">
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
        {{ id ? '编辑安排' : '安排一餐' }}
      </text>
      <view
        v-if="pending"
        class="recovery-note"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        <text>上次{{ pending.kind === 'remove' ? '移除' : '保存' }}结果尚未确认，请恢复原请求；确认前不能更改安排。</text>
        <HomeAction
          label="确认原请求结果"
          type="primary"
          data-resume
          :disabled="busy || loading"
          :loading="busy"
          @click="write('retry')"
        >
          确认原请求结果
        </HomeAction>
      </view>
      <view
        v-if="committed"
        class="recovery-note"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        <text>{{ committed.kind === 'remove' ? '已移除' : '已保存' }}{{ refreshFailed ? '，刷新失败，请重试读取；不会再次提交。' : '，可查看当前计划。' }}</text>
        <HomeAction
          label="查看计划"
          type="primary"
          data-view-plan
          @click="page.back"
        >
          查看计划
        </HomeAction>
      </view>
      <text
        v-if="loading"
        class="status"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        正在读取…
      </text>
      <view
        v-if="!invalidQuery && stage === 'search' && !committed && !pending"
        data-search-stage
      >
        <text class="field-label">
          选择家里的菜谱
        </text>
        <input
          data-query
          class="home-input"
          :value="query"
          :maxlength="120"
          aria-label="搜索菜谱"
          placeholder="输入菜名或标签"
          placeholder-style="color: var(--home-muted); opacity: 1"
          :disabled="busy || loading"
          @input="query = $event.detail.value"
          @confirm="page.act(() => search())"
        >
        <HomeAction
          label="搜索菜谱"
          type="primary"
          data-search
          :disabled="busy || loading"
          @click="page.act(() => search())"
        >
          搜索
        </HomeAction>
        <view
          v-for="row in searchItems"
          :key="row.id"
          class="search-row"
        >
          <text class="block">
            {{ row.title }}
          </text>
          <HomeAction
            :label="'选择菜谱：' + row.title"
            type="info"
            :data-choose="row.id"
            :disabled="busy || loading"
            @click="choose(row.id)"
          >
            选择这道菜
          </HomeAction>
        </view>
        <text
          v-if="searchReady && !searchItems.length && !searchCursor"
          class="status"
          role="status"
          aria-role="status"
          aria-live="polite"
        >
          {{ planning.searchQuery.value ? '没有匹配的菜谱，请换个关键词。' : '家庭还没有菜谱，请先到菜谱页添加。' }}
        </text>
        <HomeAction
          v-if="searchCursor"
          label="继续查找菜谱"
          type="info"
          data-search-more
          :disabled="busy || loading"
          @click="page.act(() => search(true))"
        >
          继续查找菜谱
        </HomeAction>
      </view>
      <view
        v-if="!invalidQuery && stage === 'form' && ready"
        data-form-stage
      >
        <text class="section">
          {{ title || '原请求中的安排' }}
        </text>
        <text
          v-if="!sourceAvailable"
          class="muted"
        >
          菜谱已不可用，保留原安排快照；仍可修改或移除安排。
        </text>
        <text
          v-if="id"
          class="muted"
        >
          菜谱不可更换；如需换菜，请明确移除此项后重新添加。
        </text>
        <HomeAction
          v-if="!id && !pending && !committed"
          label="更换菜谱"
          type="info"
          variant="text"
          data-change-recipe
          :disabled="locked"
          @click="changeRecipe"
        >
          更换菜谱
        </HomeAction>
        <wd-form
          v-if="pending?.kind !== 'remove'"
          ref="form"
          :model="draft"
          :schema="schema"
          error-type="none"
          :disabled="locked"
          :reset-on-change="false"
        >
          <wd-form-item
            prop="date"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text class="field-label">
              用餐日期
            </text>
            <picker
              data-date-picker
              mode="date"
              :value="draft.date"
              start="0001-01-01"
              end="9999-12-31"
              :disabled="locked"
              @change="changeDate($event.detail.value)"
            >
              <view
                id="date"
                class="date-target"
                role="button"
                aria-role="button"
                :aria-label="'用餐日期，' + draft.date"
                :aria-disabled="locked"
                :aria-invalid="!!fields.errors.date"
                :aria-describedby="fields.errors.date ? 'date-error' : undefined"
                :tabindex="locked ? -1 : 0"
              >
                {{ draft.date }} · 选择日期
              </view>
            </picker>
            <text
              v-if="fields.errors.date"
              id="date-error"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors.date }}
            </text>
          </wd-form-item>
          <wd-form-item
            prop="meal"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text
              id="meal"
              class="field-label"
            >
              餐次
            </text>
            <view class="meal-choices">
              <HomeAction
                v-for="meal in meals"
                :key="meal.key"
                :label="meal.title + (draft.meal === meal.key ? '，已选中' : '')"
                :pressed="draft.meal === meal.key"
                type="info"
                variant="text"
                :custom-class="'scope-tab' + (draft.meal === meal.key ? ' scope-tab--active' : '')"
                :data-meal="meal.key"
                :disabled="locked"
                @click="changeMeal(meal.key)"
              >
                {{ meal.title }}
              </HomeAction>
            </view>
            <text
              v-if="fields.errors.meal"
              id="meal-error"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors.meal }}
            </text>
          </wd-form-item>
          <wd-form-item
            prop="targetServings"
            layout="vertical"
            custom-class="home-form-item"
          >
            <text class="field-label">
              目标份数（可留空）
            </text>
            <input
              id="targetServings"
              data-servings
              type="digit"
              class="home-input"
              :value="draft.targetServings"
              :disabled="locked"
              aria-label="目标份数，留空表示未注明"
              :aria-invalid="!!fields.errors.targetServings"
              :aria-describedby="fields.errors.targetServings ? 'targetServings-error' : undefined"
              :focus="fields.focused === 'targetServings'"
              :cursor-spacing="32"
              placeholder="未注明请留空"
              placeholder-style="color: var(--home-muted); opacity: 1"
              @input="changeServings($event.detail.value)"
              @blur="validateField('targetServings')"
            >
            <text
              v-if="fields.errors.targetServings"
              id="targetServings-error"
              class="field-error"
              role="alert"
              aria-role="alert"
            >
              {{ fields.errors.targetServings }}
            </text>
          </wd-form-item>
        </wd-form>
        <HomeAction
          v-if="!pending && !committed"
          label="保存安排"
          type="primary"
          data-save
          :disabled="locked"
          :loading="busy"
          @click="write('save')"
        >
          保存安排
        </HomeAction>
        <HomeAction
          v-if="id && !pending && !committed"
          label="重新加载安排"
          type="info"
          variant="text"
          data-reload
          :disabled="locked"
          @click="reload"
        >
          重新加载安排
        </HomeAction>
        <HomeAction
          v-if="id && !pending && !committed"
          label="移除安排"
          type="danger"
          variant="text"
          data-remove
          :disabled="locked"
          @click="write('remove')"
        >
          移除安排
        </HomeAction>
      </view>
      <text
        v-if="message"
        class="status"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        {{ message }}
      </text>
      <HomeAction
        v-if="!invalidQuery && (message || committed)"
        label="重试读取"
        type="info"
        variant="text"
        data-read-retry
        :disabled="busy || loading"
        @click="retryRead"
      >
        重试读取
      </HomeAction>
      <HomeAction
        label="返回计划"
        type="info"
        variant="text"
        data-back
        :disabled="busy"
        @click="back"
      >
        返回计划
      </HomeAction>
    </view>
    <text
      v-else
      class="status"
      role="status"
      aria-role="status"
      aria-live="polite"
    >
      {{ message || copy.checking }}
    </text>
    <HomeAction
      v-if="!confirmed && message"
      label="重新检查权限"
      type="info"
      data-check
      @click="page.check"
    >
      重新检查权限
    </HomeAction>
  </view>
</template>
<style scoped>
.date-target { box-sizing: border-box; min-height: 48px; padding: 12px; border: 1px solid var(--home-border); border-radius: var(--home-radius); font-size: 1rem; }
.date-target:focus-visible { outline: 2px solid var(--home-primary); outline-offset: 3px; }
.meal-choices { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.search-row { padding: 16px 0; border-bottom: 1px solid var(--home-line); }
</style>
