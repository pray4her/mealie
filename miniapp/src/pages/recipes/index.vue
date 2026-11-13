<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import HomeBrand from '../../components/HomeBrand.vue';
import WdIcon from '@wot-ui/ui/components/wd-icon/wd-icon.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { ref, watch } from 'vue';
import { onHide } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { useRecipeCovers } from '../../features/media/use-recipe-covers';
import { copy } from '../../shared/copy';
const { rootFontSize, singleColumn } = usePageTypography();
const query = ref(''); const tag = ref(''); const adding = ref(false); const filtering = ref(false);
const page = useRecipesPage(async () => {
  query.value = page.recipes.filters.value.query; tag.value = page.recipes.filters.value.tag;
  await page.recipes.list(); page.imports.restore();
});
const { confirmed, busy, message, recipes, imports, family } = page;
const { recovery } = imports;
const { items, pending, nextCursor, filters, pendingFavorite } = recipes;
const cover = useRecipeCovers({ api: page.client.media, auth: page.auth, family, items, visible: confirmed, onAccessError: page.reconcile });
const { covers } = cover;
watch(confirmed, ready => { if (!ready) { adding.value = false; filtering.value = false; } });
onHide(() => { adding.value = false; filtering.value = false; query.value = ''; tag.value = ''; });
function search(favoritesOnly = filters.value.favoritesOnly, appliedTag = filters.value.tag) {
  void page.act(async () => {
    recipes.setFilters({ query: query.value, tag: appliedTag, favoritesOnly });
    query.value = filters.value.query; tag.value = filters.value.tag;
    await recipes.list();
  }, true);
}
function clearQuery() { query.value = ''; search(); }
function clearTag() { tag.value = ''; filtering.value = false; search(filters.value.favoritesOnly, ''); }
function applyTag() { filtering.value = false; search(filters.value.favoritesOnly, tag.value); }
function showFilter() { tag.value = filters.value.tag; filtering.value = true; }
const open = (id: string) => uni.navigateTo({ url: '/pages/recipes/detail?id=' + id });
const openFamily = () => uni.switchTab({ url: '/pages/family/home' });
function create() { adding.value = false; uni.navigateTo({ url: '/pages/recipes/edit' }); }
function importText() { adding.value = false; uni.navigateTo({ url: '/pages/imports/submit' }); }
function resume() { const intent = pending.value; if (intent) uni.navigateTo({ url: '/pages/recipes/edit' + (intent.kind === 'update' ? '?id=' + intent.input.id : '') }); }
function resumeImport() { adding.value = false; const saved = recovery.value; if (saved) uni.navigateTo({ url: saved.kind === 'pending' ? '/pages/imports/submit' : '/pages/imports/status?id=' + saved.id }); }
</script>
<template>
  <page-meta
    :root-font-size="rootFontSize"
    :page-style="adding || filtering ? 'overflow: hidden' : ''"
  />
  <view class="page recipe-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <view :aria-hidden="adding || filtering">
        <HomeBrand
          :family-name="family.view.value?.name"
          @family="openFamily"
        />
        <view class="recipe-greeting">
          <text
            class="title greeting"
            role="heading"
            aria-role="heading"
            aria-level="1"
          >
            今天，想吃什么？
          </text>
          <text class="muted">
            一家人的拿手菜，都在这里。
          </text>
        </view>
        <view class="search-row">
          <view
            class="query-field"
            data-query
          >
            <wd-icon
              name="search-line"
              size="20px"
              color="var(--home-muted)"
              aria-hidden="true"
            />
            <input
              v-model="query"
              aria-label="搜索菜谱"
              confirm-type="search"
              :maxlength="240"
              placeholder="搜索家里的菜谱"
              placeholder-style="color: #667269; opacity: 1"
              @confirm="search()"
            >
            <HomeAction
              v-if="query"
              label="清空搜索"
              data-clear-query
              appearance="icon"
              type="info"
              variant="text"
              icon="close"
              @click="clearQuery"
            />
          </view>
          <HomeAction
            label="添加菜谱"
            custom-class="add-recipe"
            data-add
            @click="adding = true"
          >
            ＋ 添加
          </HomeAction>
        </view>
        <view class="recipe-tabs">
          <HomeAction
            :label="copy.allRecipes"
            data-all
            type="info"
            variant="text"
            :pressed="!filters.favoritesOnly"
            :custom-class="!filters.favoritesOnly ? 'scope-tab scope-tab--active' : 'scope-tab'"
            @click="search(false)"
          >
            {{ copy.allRecipes }}
          </HomeAction>
          <HomeAction
            :label="copy.myFavorites"
            data-favorites
            type="info"
            variant="text"
            :pressed="filters.favoritesOnly"
            :custom-class="filters.favoritesOnly ? 'scope-tab scope-tab--active' : 'scope-tab'"
            @click="search(true)"
          >
            {{ copy.myFavorites }}
          </HomeAction>
        </view>
        <view class="filter-bar">
          <HomeAction
            label="筛选菜谱，按精确标签筛选"
            custom-class="filter-action"
            data-filter
            variant="text"
            icon="filter"
            @click="showFilter"
          >
            标签筛选
          </HomeAction>
          <text class="muted">
            最近添加
          </text>
        </view>
        <view
          v-if="filters.tag"
          class="active-filters"
        >
          <HomeAction
            :label="'清除标签：' + filters.tag"
            data-clear-tag
            variant="soft"
            appearance="text"
            @click="clearTag"
          >
            {{ filters.tag }} ×
          </HomeAction>
        </view>
        <view
          v-if="pendingFavorite"
          class="recovery-note"
        >
          <text
            role="status"
            aria-role="status"
            aria-live="polite"
          >
            {{ copy.pendingFavorite }}
          </text>
          <HomeAction
            :label="copy.resumeFavorite"
            data-resume-favorite
            variant="text"
            :disabled="busy"
            @click="page.act(async () => { await recipes.retryFavorite(); })"
          >
            {{ copy.resumeFavorite }}
          </HomeAction>
        </view>
        <view
          v-if="pending"
          class="recovery-note"
        >
          <text>{{ copy.pendingRecipe }}</text>
          <HomeAction
            :label="copy.resumeRecipe"
            data-resume
            variant="text"
            @click="resume"
          >
            {{ copy.resumeRecipe }}
          </HomeAction>
        </view>
        <view
          v-if="recovery?.kind === 'pending'"
          class="recovery-note"
        >
          <text>有一次导入提交结果待确认。</text>
          <HomeAction
            label="确认原导入请求"
            data-import-resume
            variant="text"
            @click="resumeImport"
          >
            确认原导入请求
          </HomeAction>
        </view>
        <text
          class="muted result-summary"
          role="status"
          aria-role="status"
          aria-live="polite"
        >
          {{ busy ? '正在更新菜谱…' : '已显示 ' + items.length + ' 道菜谱' }}
        </text>
        <text
          v-if="!items.length && !busy"
          class="status"
          role="status"
          aria-role="status"
          aria-live="polite"
        >
          {{ nextCursor ? copy.searchSegmentEmpty : filters.query || filters.tag || filters.favoritesOnly ? copy.noMatchingRecipes : copy.noRecipes }}
        </text>
        <view
          class="recipe-grid"
          :class="{ 'single-column': singleColumn }"
        >
          <view
            v-for="item in items"
            :key="item.id"
            class="recipe"
          >
            <view
              class="recipe-open"
              role="button"
              aria-role="button"
              :aria-label="item.title + '，' + item.authorLabel"
              tabindex="0"
              data-open-recipe
              @click="open(item.id)"
              @keydown.enter.prevent="open(item.id)"
              @keydown.space.prevent="open(item.id)"
            >
              <view aria-hidden="true">
                <view class="cover">
                  <image
                    v-if="covers[item.imageIds[0]]?.url"
                    data-cover
                    :src="covers[item.imageIds[0]].url"
                    mode="aspectFill"
                    @error="cover.failed(item.imageIds[0])"
                  />
                  <text
                    v-else
                    class="cover-label"
                  >
                    {{ item.imageIds.length ? covers[item.imageIds[0]]?.label || '图片加载中' : '暂无图片' }}
                  </text>
                </view>
                <text
                  class="recipe-name"
                  data-recipe
                >
                  {{ item.title }}
                </text>
                <text class="muted recipe-meta">
                  <text v-if="item.prepMinutes !== null && item.cookMinutes !== null">
                    {{ item.prepMinutes + item.cookMinutes }} 分钟 ·
                  </text>{{ item.authorLabel }}
                </text>
              </view>
            </view>
            <HomeAction
              :label="item.title + '，' + (item.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe)"
              data-favorite
              custom-class="favorite-action"
              appearance="icon"
              variant="text"
              :icon="item.isFavorite ? 'heart-fill' : 'heart'"
              :disabled="busy || !!pendingFavorite"
              :pressed="item.isFavorite"
              @click="page.act(async () => { await recipes.favorite(item.id, !item.isFavorite); })"
            />
            <HomeAction
              v-if="covers[item.imageIds[0]]?.failed"
              label="重试图片"
              data-retry-cover
              type="info"
              variant="text"
              @click="cover.refresh"
            >
              重试图片
            </HomeAction>
          </view>
        </view>
        <HomeAction
          v-if="nextCursor"
          :label="filters.query || filters.tag ? copy.continueSearching : copy.loadMore"
          data-more
          type="info"
          variant="plain"
          block
          :disabled="busy"
          @click="page.act(async () => { await recipes.list(true); })"
        >
          {{ filters.query || filters.tag ? copy.continueSearching : copy.loadMore }}
        </HomeAction>
      </view>
      <wd-popup
        v-model="adding"
        position="bottom"
        round
        safe-area-inset-bottom
      >
        <view
          class="sheet"
          role="dialog"
          aria-role="dialog"
          aria-modal="true"
          aria-label="添加菜谱"
        >
          <text
            class="title"
            role="heading"
            aria-role="heading"
            aria-level="1"
          >
            添加菜谱
          </text>
          <HomeAction
            :label="copy.createRecipe"
            data-create
            block
            :disabled="!!pending"
            @click="create"
          >
            {{ copy.createRecipe }}
          </HomeAction>
          <HomeAction
            label="AI 导入"
            data-import
            block
            type="info"
            variant="plain"
            @click="importText"
          >
            AI 导入
          </HomeAction>
          <HomeAction
            v-if="recovery?.kind === 'job'"
            label="最近导入任务"
            data-import-resume
            block
            type="info"
            variant="text"
            @click="resumeImport"
          >
            最近导入任务
          </HomeAction>
          <HomeAction
            :label="copy.cancel"
            block
            type="info"
            variant="text"
            @click="adding = false"
          >
            {{ copy.cancel }}
          </HomeAction>
        </view>
      </wd-popup>
      <wd-popup
        v-model="filtering"
        position="bottom"
        round
        safe-area-inset-bottom
      >
        <view
          class="sheet"
          role="dialog"
          aria-role="dialog"
          aria-modal="true"
          aria-label="筛选菜谱"
        >
          <text
            class="title"
            role="heading"
            aria-role="heading"
            aria-level="1"
          >
            筛选菜谱
          </text>
          <text class="muted">
            输入完整标签，与标题关键词共同筛选。
          </text>
          <text class="field-label">
            {{ copy.recipeTag }}
          </text>
          <input
            v-model="tag"
            class="home-input"
            :aria-label="copy.recipeTag"
            data-tag
            :maxlength="80"
            placeholder="例如：家常"
            placeholder-style="color: #667269; opacity: 1"
            confirm-type="search"
            :cursor-spacing="32"
            @confirm="applyTag"
          >
          <HomeAction
            label="应用筛选"
            data-apply-filter
            block
            @click="applyTag"
          >
            应用筛选
          </HomeAction>
          <HomeAction
            label="清除标签"
            data-clear-filter
            block
            type="info"
            variant="plain"
            @click="clearTag"
          >
            清除标签
          </HomeAction>
          <HomeAction
            :label="copy.cancel"
            block
            type="info"
            variant="text"
            @click="filtering = false"
          >
            {{ copy.cancel }}
          </HomeAction>
        </view>
      </wd-popup>
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
      class="status error"
      role="alert"
      aria-role="alert"
      aria-live="assertive"
    >
      {{ message }}
    </text>
    <HomeAction
      v-if="message"
      :label="copy.retry"
      data-retry
      type="info"
      variant="plain"
      @click="page.check"
    >
      {{ copy.retry }}
    </HomeAction>
  </view>
</template>
<style scoped>
.recipe-page { background: var(--home-surface); min-height: 100vh; }
.recipe-greeting { margin: 12px 0; }
.greeting { font-size: 1.6875rem; margin-bottom: 4px; font-weight: 700; }
.search-row { display: flex; align-items: stretch; gap: 10px; margin: 12px 0 8px; }
.query-field { display: flex; flex: 1; align-items: center; min-width: 0; min-height: 48px; padding-left: 12px; gap: 8px; box-sizing: border-box; border: 1px solid var(--home-border); border-radius: 10px; background: var(--home-bg); }
.query-field input { flex: 1; min-width: 0; height: 100%; min-height: 46px; color: var(--home-text); font-size: 1rem; }
.recipe-tabs { display: flex; align-items: stretch; gap: 24px; border-bottom: 1px solid var(--home-line); }
.filter-bar { display: flex; align-items: center; justify-content: space-between; min-height: 56px; margin-top: 8px; }
.active-filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.result-summary { margin: 4px 0 12px; }
.recipe-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 12px; margin-bottom: 24px; }
.recipe { position: relative; min-width: 0; }
.recipe-open { cursor: pointer; border-radius: 12px; }
.cover { position: relative; padding-top: 75%; background: var(--home-bg); border-radius: 12px; overflow: hidden; }
.cover image, .cover-label { position: absolute; inset: 0; width: 100%; height: 100%; }
.cover-label { display: flex; align-items: center; justify-content: center; color: var(--home-muted); font-size: .875rem; }
.recipe-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 6px; font-size: 1rem; line-height: 1.5; font-weight: 600; }
.recipe-meta { margin-top: 4px; }
.single-column { grid-template-columns: minmax(0, 1fr); }
</style>
