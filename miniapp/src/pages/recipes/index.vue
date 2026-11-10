<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { useRecipeCovers } from '../../features/recipes/use-recipe-covers';
import PrivateImage from '../../components/PrivateImage.vue';
import { resetPage } from '../../shared/navigation';
import { copy } from '../../shared/copy';
const query = ref(''); const tag = ref(''); const showAdd = ref(false); const showTag = ref(false); const largeFont = ref(false);
const page = useRecipesPage(async () => {
  query.value = page.recipes.filters.value.query; tag.value = page.recipes.filters.value.tag;
  await page.recipes.list(); page.imports.restore();
});
const { confirmed, busy, message, recipes, imports, family } = page;
const { recovery } = imports;
const { items, pending, nextCursor, filters, pendingFavorite } = recipes;
const { covers, retry: retryCover, fail: failCover } = useRecipeCovers(page);
const actions = computed(() => [{ name: '手动创建菜谱', disabled: !!pending.value }, { name: 'AI 文本导入' }]);
watch(confirmed, value => { if (!value) showAdd.value = false; });
onShow(() => { largeFont.value = (uni.getAppBaseInfo?.().hostFontSizeSetting ?? uni.getSystemInfoSync?.().fontSizeSetting ?? 16) > 16; });
function search(favoritesOnly = filters.value.favoritesOnly) {
  void page.act(async () => {
    recipes.setFilters({ query: query.value, tag: tag.value, favoritesOnly });
    query.value = filters.value.query; tag.value = filters.value.tag;
    await recipes.list();
  }, true);
}
const open = (id: string) => uni.navigateTo({ url: '/pages/recipes/detail?id=' + id });
function add({ index }: { index: number }) { uni.navigateTo({ url: index === 0 ? '/pages/recipes/edit' : '/pages/imports/submit' }); }
function resume() { const intent = pending.value; if (intent) uni.navigateTo({ url: '/pages/recipes/edit' + (intent.kind === 'update' ? '?id=' + intent.input.id : '') }); }
function resumeImport() { const saved = recovery.value; if (saved) uni.navigateTo({ url: saved.kind === 'pending' ? '/pages/imports/submit' : '/pages/imports/status?id=' + saved.id }); }
</script>
<template>
  <view class="page recipe-list">
    <view
      v-if="confirmed"
      data-protected
    >
      <view class="page-heading">
        <view>
          <text class="eyebrow">
            {{ family.view.value?.name }}
          </text><text class="title">
            今天做点什么？
          </text>
        </view>
        <wd-button
          data-create
          :disabled="busy"
          @click="showAdd = true"
        >
          添加
        </wd-button>
      </view>
      <view class="filters">
        <text class="filter-label">
          {{ copy.recipeQuery }}
        </text>
        <wd-input
          v-model="query"
          data-query
          :maxlength="240"
          :aria-label="copy.recipeQuery"
          :placeholder="copy.recipeQuery"
          confirm-type="search"
          @confirm="search()"
        />
        <view class="search-actions">
          <wd-button
            data-toggle-tag
            variant="text"
            :aria-expanded="showTag"
            @click="showTag = !showTag"
          >
            {{ showTag ? '收起标签筛选' : '精确标签筛选' }}
          </wd-button>
          <wd-button
            data-search
            @click="search()"
          >
            {{ copy.searchRecipes }}
          </wd-button>
        </view>
        <view v-show="showTag || tag">
          <text class="filter-label">
            {{ copy.recipeTag }}
          </text>
          <wd-input
            v-model="tag"
            data-tag
            :maxlength="80"
            :aria-label="copy.recipeTag"
            :placeholder="copy.recipeTag"
            confirm-type="search"
            @confirm="search()"
          />
          <text class="helper">
            {{ copy.recipeSearchHint }}
          </text>
        </view>
      </view>
      <view class="tabs">
        <wd-button
          data-all
          variant="text"
          :custom-class="!filters.favoritesOnly ? 'selected-tab' : ''"
          :aria-pressed="!filters.favoritesOnly"
          @click="search(false)"
        >
          {{ copy.allRecipes }}
        </wd-button>
        <wd-button
          data-favorites
          variant="text"
          :custom-class="filters.favoritesOnly ? 'selected-tab' : ''"
          :aria-pressed="filters.favoritesOnly"
          @click="search(true)"
        >
          {{ copy.myFavorites }}
        </wd-button>
      </view>
      <view
        v-if="recovery"
        class="notice"
      >
        <text>最近的 AI 导入任务可以继续查看。</text><wd-button
          data-import-resume
          variant="text"
          @click="resumeImport"
        >
          恢复最近导入任务
        </wd-button>
      </view>
      <view
        v-if="pendingFavorite"
        class="notice"
        role="status"
      >
        <text>{{ copy.pendingFavorite }}</text><wd-button
          data-resume-favorite
          variant="text"
          :disabled="busy"
          @click="page.act(async () => { await recipes.retryFavorite(); })"
        >
          {{ copy.resumeFavorite }}
        </wd-button>
      </view>
      <view
        v-if="pending"
        class="notice"
        role="status"
      >
        <text>{{ copy.pendingRecipe }}</text><wd-button
          data-resume
          variant="text"
          @click="resume"
        >
          {{ copy.resumeRecipe }}
        </wd-button>
      </view>
      <text class="results-line">
        当前已加载 {{ items.length }} 道{{ nextCursor ? ' · 还有菜谱可继续查找' : '' }}
      </text>
      <text
        v-if="busy"
        class="status"
        role="status"
      >
        正在加载，请稍候…
      </text>
      <view
        v-if="!items.length && !busy && !message"
        class="empty"
        role="status"
      >
        <text>{{ nextCursor ? copy.searchSegmentEmpty : filters.query || filters.tag ? copy.noMatchingRecipes : filters.favoritesOnly ? '还没有收藏的菜谱' : copy.noRecipes }}</text>
        <text class="helper">
          {{ nextCursor ? '继续查找下一段菜谱。' : filters.favoritesOnly ? '在家庭菜谱中收藏喜欢的菜。' : filters.query || filters.tag ? '试试其他标题或精确标签。' : '记下第一道拿手菜，和家人一起分享。' }}
        </text>
      </view>
      <view
        class="recipe-grid"
        :class="{ 'large-font': largeFont }"
      >
        <view
          v-for="item in items"
          :key="item.id"
          class="recipe"
        >
          <PrivateImage
            :cover="covers[item.imageIds[0]]"
            :label="item.title + '的菜图'"
            @retry="retryCover(item.imageIds[0])"
            @error="failCover(item.imageIds[0])"
            @open="open(item.id)"
          />
          <wd-button
            data-recipe
            variant="text"
            custom-class="recipe-title"
            :aria-label="'查看菜谱：' + item.title"
            @click="open(item.id)"
          >
            {{ item.title }}
          </wd-button>
          <text class="recipe-meta">
            {{ item.authorLabel }}
          </text>
          <text
            v-if="item.prepMinutes !== null || item.cookMinutes !== null"
            class="recipe-meta"
          >
            {{ item.prepMinutes !== null ? '准备 ' + item.prepMinutes + ' 分钟' : '' }}{{ item.prepMinutes !== null && item.cookMinutes !== null ? ' · ' : '' }}{{ item.cookMinutes !== null ? '烹饪 ' + item.cookMinutes + ' 分钟' : '' }}
          </text>
          <wd-button
            data-favorite
            variant="text"
            custom-class="favorite"
            :disabled="busy || !!pendingFavorite"
            :aria-pressed="item.isFavorite"
            :aria-label="(item.isFavorite ? '取消收藏：' : '收藏：') + item.title"
            @click="page.act(async () => { await recipes.favorite(item.id, !item.isFavorite); })"
          >
            {{ item.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
          </wd-button>
        </view>
      </view>
      <text
        v-if="message"
        class="status"
        role="status"
      >
        {{ message }}{{ nextCursor ? ' 已加载的菜谱仍保留，请重试继续查找。' : '' }}
      </text>
      <wd-button
        v-if="nextCursor"
        data-more
        block
        :disabled="busy"
        :loading="busy"
        @click="page.act(async () => { await recipes.list(true); })"
      >
        {{ filters.query || filters.tag || filters.favoritesOnly || !items.length ? copy.continueSearching : copy.loadMore }}
      </wd-button>
      <wd-action-sheet
        v-model="showAdd"
        title="添加家庭菜谱"
        :actions="actions"
        cancel-text="取消"
        @select="add"
      />
    </view>
    <text
      v-else
      class="status"
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <wd-button
      variant="text"
      @click="resetPage('/pages/family/home')"
    >
      {{ copy.backHome }}
    </wd-button>
    <wd-button
      v-if="message && !nextCursor"
      data-retry
      :disabled="busy"
      @click="page.check"
    >
      {{ copy.retry }}
    </wd-button>
  </view>
</template>
<style scoped>
.page { padding: 20px 20px calc(24px + env(safe-area-inset-bottom)); background: var(--app-surface); min-height: 100vh; box-sizing: border-box; }
.page-heading, .search-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.page-heading { margin: 8px 0 24px; }
.eyebrow, .title, .helper, .results-line, .recipe-meta { display: block; }
.eyebrow { color: var(--app-primary); font-size: 14px; overflow-wrap: anywhere; }
.title { font-size: 27px; font-weight: 600; line-height: 1.4; margin-top: 4px; }
.filter-label { display: block; font-size: 14px; margin: 8px 0; }
.filters :deep(.wd-input) { border: 1px solid #78867c; border-radius: 10px; padding: 8px 12px; }
.helper, .results-line, .recipe-meta { color: var(--app-text-secondary); font-size: 14px; }
.helper { margin-top: 8px; }
.tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--app-border); margin: 20px 0 16px; }
.tabs :deep(.selected-tab) { border-bottom: 3px solid var(--app-primary); font-weight: 600; }
.results-line { margin-bottom: 16px; }
.recipe-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 13px; }
.recipe-grid.large-font { grid-template-columns: minmax(0, 1fr); }
.recipe { min-width: 0; }
.recipe :deep(.recipe-title) { width: 100%; min-height: 44px; height: auto; text-align: left; padding: 8px 0 0; white-space: normal; font-size: 16px; font-weight: 600; color: var(--app-text); }
.recipe :deep(.recipe-title .wd-button__content) { justify-content: flex-start; }
.recipe :deep(.recipe-title .wd-button__text) { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; line-height: 1.6; }
.recipe-meta { overflow-wrap: anywhere; }
.recipe :deep(.favorite) { padding-left: 0; }
.empty { padding: 40px 12px; text-align: center; }
.notice { padding: 12px 0; border-bottom: 1px solid var(--app-border); font-size: 14px; }
.status { display: block; padding: 20px 0; }
@media (max-width: 340px) { .page { padding-left: 16px; padding-right: 16px; } .recipe-grid { grid-template-columns: minmax(0, 1fr); } .page-heading { flex-wrap: wrap; } }
</style>
