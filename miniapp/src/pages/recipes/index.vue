<script setup lang="ts">
import { ref, watch } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { useRecipeCovers } from '../../features/media/use-recipe-covers';
import { copy } from '../../shared/copy';
const query = ref(''); const tag = ref(''); const adding = ref(false);
const page = useRecipesPage(async () => {
  query.value = page.recipes.filters.value.query; tag.value = page.recipes.filters.value.tag;
  await page.recipes.list(); page.imports.restore();
});
const { confirmed, busy, message, recipes, imports, family } = page;
const { recovery } = imports;
const { items, pending, nextCursor, filters, pendingFavorite } = recipes;
const cover = useRecipeCovers({ api: page.client.media, auth: page.auth, family, items, visible: confirmed, onAccessError: page.reconcile });
const { covers } = cover; const singleColumn = ref(false);
onShow(() => { const info = uni.getSystemInfoSync(); singleColumn.value = info.windowWidth < 360 || (info.fontSizeSetting ?? 16) >= 20; });
watch(confirmed, ready => { if (!ready) adding.value = false; });
onHide(() => { adding.value = false; query.value = ''; tag.value = ''; });
function search(favoritesOnly = filters.value.favoritesOnly) {
  void page.act(async () => {
    recipes.setFilters({ query: query.value, tag: tag.value, favoritesOnly });
    query.value = filters.value.query; tag.value = filters.value.tag;
    await recipes.list();
  }, true);
}
const open = (id: string) => uni.navigateTo({ url: '/pages/recipes/detail?id=' + id });
function create() { adding.value = false; uni.navigateTo({ url: '/pages/recipes/edit' }); }
function importText() { adding.value = false; uni.navigateTo({ url: '/pages/imports/submit' }); }
function resume() { const intent = pending.value; if (intent) uni.navigateTo({ url: '/pages/recipes/edit' + (intent.kind === 'update' ? '?id=' + intent.input.id : '') }); }
function resumeImport() { const saved = recovery.value; if (saved) uni.navigateTo({ url: saved.kind === 'pending' ? '/pages/imports/submit' : '/pages/imports/status?id=' + saved.id }); }
</script>
<template>
  <view class="page recipe-page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="eyebrow">
        {{ family.view.value?.name }}
      </text>
      <text class="title">
        今天，做点家常菜
      </text>
      <view class="search-row">
        <view class="query-field">
          <text class="filter-label">
            {{ copy.recipeQuery }}
          </text>
          <wd-search
            v-model="query"
            data-query
            placeholder-left
            hide-cancel
            :maxlength="240"
            :placeholder="copy.recipeQuery"
            @search="search()"
          />
        </view>
        <wd-button
          data-add
          @click="adding = true"
        >
          添加
        </wd-button>
      </view>
      <view class="actions tabs">
        <wd-button
          data-all
          :variant="!filters.favoritesOnly ? 'soft' : 'text'"
          :aria-pressed="!filters.favoritesOnly"
          @click="search(false)"
        >
          {{ copy.allRecipes }}{{ !filters.favoritesOnly ? '（已选）' : '' }}
        </wd-button>
        <wd-button
          data-favorites
          :variant="filters.favoritesOnly ? 'soft' : 'text'"
          :aria-pressed="filters.favoritesOnly"
          @click="search(true)"
        >
          {{ copy.myFavorites }}{{ filters.favoritesOnly ? '（已选）' : '' }}
        </wd-button>
      </view>
      <view class="tag-filter">
        <text class="filter-label">
          {{ copy.recipeTag }}
        </text>
        <wd-input
          v-model="tag"
          data-tag
          :maxlength="80"
          :placeholder="copy.recipeTag"
          confirm-type="search"
          @confirm="search()"
        />
        <text class="muted">
          {{ copy.recipeSearchHint }}
        </text>
        <wd-button
          data-search
          type="info"
          @click="search()"
        >
          {{ copy.searchRecipes }}
        </wd-button>
      </view>
      <view
        v-if="pendingFavorite"
        class="status"
      >
        <text role="status">
          {{ copy.pendingFavorite }}
        </text>
        <wd-button
          data-resume-favorite
          :disabled="busy"
          :aria-disabled="busy"
          @click="page.act(async () => { await recipes.retryFavorite(); })"
        >
          {{ copy.resumeFavorite }}
        </wd-button>
      </view>
      <view
        v-if="pending"
        class="status"
      >
        <text>{{ copy.pendingRecipe }}</text>
        <wd-button
          data-resume
          @click="resume"
        >
          {{ copy.resumeRecipe }}
        </wd-button>
      </view>
      <wd-button
        v-if="recovery"
        data-import-resume
        type="info"
        @click="resumeImport"
      >
        恢复最近导入任务
      </wd-button>
      <text
        v-if="busy"
        class="status"
        role="status"
      >
        正在更新菜谱…
      </text>
      <text
        v-if="!items.length"
        class="status"
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
          <view class="cover">
            <image
              v-if="covers[item.imageIds[0]]?.url"
              data-cover
              :src="covers[item.imageIds[0]].url"
              mode="aspectFill"
              :aria-label="item.title + '封面'"
              @tap="open(item.id)"
              @error="cover.failed(item.imageIds[0])"
            />
            <text
              v-else
              class="cover-label"
            >
              {{ item.imageIds.length ? covers[item.imageIds[0]]?.label || '图片加载中' : '暂无图片' }}
            </text>
          </view>
          <wd-button
            v-if="covers[item.imageIds[0]]?.failed"
            data-retry-cover
            type="info"
            variant="text"
            @click="cover.refresh"
          >
            重试图片
          </wd-button>
          <wd-button
            data-recipe
            type="info"
            variant="text"
            @click="open(item.id)"
          >
            {{ item.title }}
          </wd-button>
          <text class="muted">
            {{ item.authorLabel }}
          </text>
          <text
            v-if="item.prepMinutes !== null && item.cookMinutes !== null"
            class="muted"
          >
            {{ item.prepMinutes + item.cookMinutes }} 分钟
          </text>
          <wd-button
            data-favorite
            variant="text"
            :disabled="busy || !!pendingFavorite"
            :aria-disabled="busy || !!pendingFavorite"
            :aria-pressed="item.isFavorite"
            @click="page.act(async () => { await recipes.favorite(item.id, !item.isFavorite); })"
          >
            {{ item.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
          </wd-button>
        </view>
      </view>
      <wd-button
        v-if="nextCursor"
        data-more
        type="info"
        :disabled="busy"
        :aria-disabled="busy"
        @click="page.act(async () => { await recipes.list(true); })"
      >
        {{ filters.query || filters.tag ? copy.continueSearching : copy.loadMore }}
      </wd-button>
      <wd-popup
        v-model="adding"
        position="bottom"
        round
        safe-area-inset-bottom
      >
        <view class="sheet">
          <text class="title">
            添加菜谱
          </text>
          <wd-button
            data-create
            block
            :disabled="!!pending"
            :aria-disabled="!!pending"
            @click="create"
          >
            {{ copy.createRecipe }}
          </wd-button>
          <wd-button
            data-import
            block
            type="info"
            @click="importText"
          >
            AI 文本导入
          </wd-button>
          <wd-button
            block
            type="info"
            variant="text"
            @click="adding = false"
          >
            {{ copy.cancel }}
          </wd-button>
        </view>
      </wd-popup>
    </view>
    <text
      v-else
      class="status"
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <text
      v-if="confirmed && message"
      class="status error"
      role="alert"
    >
      {{ message }}
    </text>
    <wd-button
      v-if="message"
      data-retry
      type="info"
      @click="page.check"
    >
      {{ copy.retry }}
    </wd-button>
  </view>
</template>
<style scoped>
.recipe-page { background: var(--home-surface); min-height: 100vh; }
.search-row { display: flex; align-items: flex-end; gap: 12px; }
.query-field { flex: 1; min-width: 0; }
.filter-label { display: block; font-size: 14px; margin-bottom: 8px; }
.tag-filter { margin: 16px 0 24px; display: flex; flex-direction: column; gap: 8px; }
.recipe-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 12px; margin: 24px 0; }
.recipe { min-width: 0; }
.cover { position: relative; padding-top: 75%; background: var(--home-bg); border-radius: 12px; overflow: hidden; }
.cover image, .cover-label { position: absolute; inset: 0; width: 100%; height: 100%; }
.cover-label { display: flex; align-items: center; justify-content: center; color: var(--home-muted); font-size: 14px; }
.single-column { grid-template-columns: minmax(0, 1fr); }
@media (max-width: 359px) { .recipe-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
