<script setup lang="ts">
import { ref } from 'vue';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { copy } from '../../shared/copy';
const query = ref(''); const tag = ref('');
const page = useRecipesPage(async () => {
  query.value = page.recipes.filters.value.query; tag.value = page.recipes.filters.value.tag;
  await page.recipes.list();
});
const { confirmed, busy, message, recipes } = page;
const { items, pending, nextCursor, filters, pendingFavorite } = recipes;
function search(favoritesOnly = filters.value.favoritesOnly) {
  void page.act(async () => {
    recipes.setFilters({ query: query.value, tag: tag.value, favoritesOnly });
    query.value = filters.value.query; tag.value = filters.value.tag;
    await recipes.list();
  }, true);
}
const open = (id: string) => uni.navigateTo({ url: '/pages/recipes/detail?id=' + id });
const create = () => uni.navigateTo({ url: '/pages/recipes/edit' });
function resume() { const intent = pending.value; if (intent) uni.navigateTo({ url: '/pages/recipes/edit' + (intent.kind === 'update' ? '?id=' + intent.input.id : '') }); }
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed"
      data-protected
    >
      <text class="title">
        {{ copy.recipes }}
      </text>
      <view class="filters">
        <button
          data-all
          :aria-pressed="!filters.favoritesOnly"
          @tap="search(false)"
        >
          {{ copy.allRecipes }}
        </button>
        <button
          data-favorites
          :aria-pressed="filters.favoritesOnly"
          @tap="search(true)"
        >
          {{ copy.myFavorites }}
        </button>
        <input
          data-query
          :value="query"
          :maxlength="240"
          :placeholder="copy.recipeQuery"
          :aria-label="copy.recipeQuery"
          confirm-type="search"
          @input="query = $event.detail.value"
          @confirm="search()"
        >
        <input
          data-tag
          :value="tag"
          :maxlength="80"
          :placeholder="copy.recipeTag"
          :aria-label="copy.recipeTag"
          confirm-type="search"
          @input="tag = $event.detail.value"
          @confirm="search()"
        >
        <button
          data-search
          @tap="search()"
        >
          {{ copy.searchRecipes }}
        </button>
      </view>
      <view v-if="pendingFavorite">
        <text role="status">
          {{ copy.pendingFavorite }}
        </text>
        <button
          data-resume-favorite
          :disabled="busy"
          @tap="page.act(async () => { await recipes.retryFavorite(); })"
        >
          {{ copy.resumeFavorite }}
        </button>
      </view>
      <view v-if="pending">
        <text>{{ copy.pendingRecipe }}</text>
        <button
          data-resume
          @tap="resume"
        >
          {{ copy.resumeRecipe }}
        </button>
      </view>
      <button
        data-create
        :disabled="!!pending"
        @tap="create"
      >
        {{ copy.createRecipe }}
      </button>
      <text v-if="!items.length">
        {{ nextCursor ? copy.searchSegmentEmpty : filters.query || filters.tag || filters.favoritesOnly ? copy.noMatchingRecipes : copy.noRecipes }}
      </text>
      <view
        v-for="item in items"
        :key="item.id"
        class="recipe"
      >
        <button
          data-recipe
          @tap="open(item.id)"
        >
          {{ item.title }}
        </button>
        <text>{{ item.authorLabel }}</text>
        <button
          data-favorite
          :disabled="busy || !!pendingFavorite"
          :aria-pressed="item.isFavorite"
          @tap="page.act(async () => { await recipes.favorite(item.id, !item.isFavorite); })"
        >
          {{ item.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
        </button>
      </view>
      <button
        v-if="nextCursor"
        data-more
        :disabled="busy"
        @tap="page.act(async () => { await recipes.list(true); })"
      >
        {{ filters.query || filters.tag || filters.favoritesOnly || !items.length ? copy.continueSearching : copy.loadMore }}
      </button>
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
      data-retry
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
.title { display: block; font-size: 40rpx; }
.recipe { margin-top: 24rpx; padding: 16rpx; background: white; }
button { margin: 24rpx 0; }
</style>
