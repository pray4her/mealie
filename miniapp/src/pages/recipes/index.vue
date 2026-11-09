<script setup lang="ts">
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { copy } from '../../shared/copy';
const page = useRecipesPage(async () => { await page.recipes.list(); });
const { confirmed, busy, message, recipes } = page;
const { items, pending, nextCursor } = recipes;
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
        {{ copy.noRecipes }}
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
      </view>
      <button
        v-if="nextCursor"
        data-more
        :disabled="busy"
        @tap="page.act(async () => { await recipes.list(true); })"
      >
        {{ copy.loadMore }}
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
