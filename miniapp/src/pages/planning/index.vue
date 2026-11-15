<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide } from '@dcloudio/uni-app';
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { usePlanningPage } from '../../features/planning/use-planning-page';
import { beijingToday, shiftLocalDate, weekDates } from '../../features/planning/dates';
import type { MealType } from 'home-contracts';
import { copy } from '../../shared/copy';

const { rootFontSize } = usePageTypography();
const today = ref(beijingToday(Date.now())); const loading = ref(false); const loaded = ref(false);
const failedCovers = ref<Record<string, boolean>>({}); let revision = 0;
const page = usePlanningPage(() => read());
const { planning, confirmed, busy, message } = page;
const { selectedDate, items, nextCursor, pending, confirmed: acknowledgement, readError, coverUrls } = planning;
const meals: { key: MealType; title: string }[] = [{ key: 'breakfast', title: '早餐' }, { key: 'lunch', title: '午餐' }, { key: 'dinner', title: '晚餐' }, { key: 'other', title: '其他' }];
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const dates = computed(() => weekDates(selectedDate.value));
function adjacent(days: number) { try { return shiftLocalDate(selectedDate.value, days); } catch { return null; } }
const previous = computed(() => adjacent(-7)); const next = computed(() => adjacent(7));
const complete = computed(() => loaded.value && !loading.value && !readError.value && !nextCursor.value);
onHide(() => { revision++; loading.value = false; loaded.value = false; failedCovers.value = {}; });
async function read(more = false) {
  const current = ++revision; loading.value = true; today.value = beijingToday(Date.now());
  if (!more) { loaded.value = false; failedCovers.value = {}; }
  try {
    await planning.list(more); if (current !== revision || !page.isCurrent()) return;
    loaded.value = true; await planning.loadCovers();
  } finally { if (current === revision) loading.value = false; }
}
async function select(date: string | null) {
  if (!date) return;
  await page.act(async () => { planning.selectDate(date); await read(); }, true);
}
function add(meal: MealType) {
  if (page.isCurrent() && !pending.value) uni.navigateTo({ url: '/pages/planning/edit?date=' + selectedDate.value + '&meal=' + meal });
}
function open(url: string) { if (page.isCurrent()) uni.navigateTo({ url }); }
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
  <view class="page planning-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="eyebrow">
        一起安排家里的每一餐
      </text>
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
        用餐计划
      </text>
      <view class="date-tools">
        <HomeAction
          label="上一周"
          type="info"
          variant="text"
          data-prev-week
          :disabled="!previous"
          @click="select(previous)"
        >
          上一周
        </HomeAction>
        <picker
          data-date-picker
          mode="date"
          :value="selectedDate"
          start="0001-01-01"
          end="9999-12-31"
          @change="select($event.detail.value)"
        >
          <view
            class="date-target"
            role="button"
            aria-role="button"
            :aria-label="'选择日期，当前 ' + selectedDate"
            tabindex="0"
          >
            {{ selectedDate }} · 选日期
          </view>
        </picker>
        <HomeAction
          label="下一周"
          type="info"
          variant="text"
          data-next-week
          :disabled="!next"
          @click="select(next)"
        >
          下一周
        </HomeAction>
        <HomeAction
          label="回到今天"
          type="info"
          variant="text"
          data-today
          @click="select(beijingToday(Date.now()))"
        >
          今天
        </HomeAction>
      </view>
      <scroll-view
        scroll-x
        class="week-scroll"
      >
        <view class="week-dates">
          <HomeAction
            v-for="(date, index) in dates"
            :key="date"
            :data-day="date"
            :label="date + ' ' + weekdays[index] + (date === today ? '，今天' : '') + (date === selectedDate ? '，已选中' : '')"
            :pressed="date === selectedDate"
            type="info"
            variant="text"
            :custom-class="'week-day' + (date === selectedDate ? ' week-day--selected' : '')"
            @click="select(date)"
          >
            <text class="day-line">
              {{ weekdays[index] }}
            </text><text class="day-line">
              {{ date.slice(8) }}
            </text><text class="day-note">
              {{ date === today ? '今天' : date === selectedDate ? '已选' : '' }}
            </text>
          </HomeAction>
        </view>
      </scroll-view>
      <view
        v-if="pending"
        class="recovery-note"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        <text>上次操作结果尚未确认，请先恢复原请求。</text>
        <HomeAction
          label="恢复原请求"
          type="info"
          data-resume
          @click="open('/pages/planning/edit')"
        >
          恢复原请求
        </HomeAction>
      </view>
      <text
        v-if="acknowledgement"
        class="status"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        {{ acknowledgement.kind === 'remove' ? '已移除' : '已保存' }}{{ readError ? '，刷新失败，请重试读取。' : '，以下为当前日期的安排。' }}
      </text>
      <text
        v-if="loading"
        class="status"
        role="status"
        aria-role="status"
        aria-live="polite"
      >
        {{ items.length ? '正在继续加载…' : '正在读取当天安排…' }}
      </text>
      <view
        v-for="meal in meals"
        :key="meal.key"
        class="meal-panel"
        :data-meal-panel="meal.key"
      >
        <view class="meal-heading">
          <text
            class="section"
            role="heading"
            aria-role="heading"
            aria-level="2"
          >
            {{ meal.title }}
          </text>
          <HomeAction
            :label="'添加' + meal.title + '安排'"
            type="info"
            variant="text"
            :data-add="meal.key"
            :disabled="!!pending"
            @click="add(meal.key)"
          >
            添加
          </HomeAction>
        </view>
        <view
          v-for="row in items.filter(item => item.meal === meal.key)"
          :key="row.id"
          class="plan-entry"
          data-plan-entry
        >
          <view class="plan-photo">
            <image
              v-if="coverUrls[row.id] && !failedCovers[row.id]"
              :src="coverUrls[row.id]"
              mode="aspectFill"
              :aria-label="row.titleSnapshot + '图片'"
              @error="failedCovers[row.id] = true"
            />
            <text
              v-else
              data-cover-fallback
              class="muted"
            >
              暂无图片
            </text>
          </view>
          <view class="plan-content">
            <text class="plan-title">
              {{ row.titleSnapshot }}
            </text>
            <text class="muted">
              {{ row.targetServings === null ? '份数未注明' : row.targetServings + ' 份' }}
            </text>
            <text
              v-if="!row.sourceAvailable"
              class="muted"
            >
              菜谱已不可用，保留安排快照
            </text>
            <view class="entry-actions">
              <HomeAction
                :label="'编辑安排：' + row.titleSnapshot"
                type="info"
                variant="text"
                :data-edit="row.id"
                @click="open('/pages/planning/edit?id=' + row.id)"
              >
                编辑安排
              </HomeAction>
              <HomeAction
                v-if="row.sourceAvailable"
                :label="'查看菜谱：' + row.titleSnapshot"
                type="info"
                variant="text"
                data-source
                @click="open('/pages/recipes/detail?id=' + row.recipeId)"
              >
                查看菜谱
              </HomeAction>
            </view>
          </view>
        </view>
        <text
          v-if="!items.some(item => item.meal === meal.key)"
          class="muted"
        >
          {{ complete ? '还没有安排，添加一道家常菜吧。' : '尚未显示安排，请等待或继续读取。' }}
        </text>
      </view>
      <HomeAction
        v-if="nextCursor"
        label="继续加载当天安排"
        type="info"
        data-more
        :disabled="busy || loading"
        :loading="loading"
        @click="page.act(() => read(true))"
      >
        继续加载当天安排
      </HomeAction>
      <HomeAction
        label="重新读取安排"
        type="info"
        variant="text"
        data-read-retry
        :disabled="busy || loading"
        @click="page.act(() => read())"
      >
        重新读取安排
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
    <text
      v-if="confirmed && message"
      class="status"
      role="status"
      aria-role="status"
      aria-live="polite"
    >
      {{ message }}
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
.date-tools, .meal-heading, .entry-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.date-target { box-sizing: border-box; min-height: 48px; padding: 12px; border: 1px solid var(--home-border); border-radius: var(--home-radius); font-size: 1rem; }
.week-scroll { display: block; width: 100%; min-width: 0; margin: 16px 0 24px; }
.week-dates { display: flex; gap: 8px; }
.week-dates :deep(.home-action.week-day) { flex: 0 0 56px; min-width: 56px; padding: 4px; }
.week-dates :deep(.week-day--selected) { background: var(--home-selected); color: var(--home-primary); border-radius: var(--home-radius); }
.day-line { display: block; }
.day-note { display: block; min-height: 1.4em; font-size: .875rem; }
.meal-panel { padding: 12px 0 20px; border-bottom: 1px solid var(--home-line); }
.meal-heading { justify-content: space-between; margin-bottom: 12px; }
.meal-heading .section { margin: 0; }
.plan-entry { display: flex; gap: 12px; padding: 12px 0; }
.plan-photo { width: 88px; height: 66px; flex: 0 0 88px; border-radius: 10px; background: var(--home-bg); overflow: hidden; display: flex; align-items: center; justify-content: center; }
.plan-photo image { width: 100%; height: 100%; }
.plan-content { flex: 1; min-width: 0; }
.plan-title { display: block; font-weight: 600; }
.entry-actions { gap: 8px; }
</style>
