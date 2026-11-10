<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { validId } from '../../features/recipes/validation';
import { AppError } from '../../shared/errors';
import { copy } from '../../shared/copy';
const id = ref<string | null>(null);
onLoad(query => { try { id.value = validId(query?.id); } catch { id.value = null; } });
const page = useRecipesPage(async () => { if (!id.value) throw new AppError('INVALID_INPUT'); const recipe = await page.recipes.get(id.value); if (recipe) await page.media.initialize(recipe); });
const { confirmed, busy, message, recipes, media } = page;
const { items: images, links: imageLinks } = media;
const { recipe, pendingFavorite } = recipes;
const edit = () => { if (recipe.value) uni.navigateTo({ url: '/pages/recipes/edit?id=' + recipe.value.id }); };
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed && recipe"
      data-protected
    >
      <text class="title">
        {{ recipe.title }}
      </text>
      <text>{{ recipe.authorLabel }}</text>
      <view
        v-for="image in images"
        :key="image.mediaId"
      >
        <image
          v-if="imageLinks[image.mediaId]"
          data-recipe-image
          :src="imageLinks[image.mediaId].url"
          mode="aspectFit"
          class="recipe-image"
          aria-label="预览菜谱图片"
          @tap="page.act(async () => { await media.preview(image.mediaId); })"
        />
      </view>
      <button
        data-favorite
        :disabled="busy || !!pendingFavorite"
        :aria-pressed="recipe.isFavorite"
        @tap="page.act(async () => { if (recipe) await recipes.favorite(recipe.id, !recipe.isFavorite); })"
      >
        {{ recipe.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
      </button>
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
      <text
        v-if="message"
        role="status"
      >
        {{ message }}
      </text>
      <text
        v-if="recipe.description"
        class="block"
      >
        {{ recipe.description }}
      </text>
      <text
        v-if="recipe.baseServings !== null"
        class="block"
      >
        {{ copy.servings }}：{{ recipe.baseServings }}
      </text>
      <text
        v-if="recipe.prepMinutes !== null"
        class="block"
      >
        {{ copy.prepMinutes }}：{{ recipe.prepMinutes }}
      </text>
      <text
        v-if="recipe.cookMinutes !== null"
        class="block"
      >
        {{ copy.cookMinutes }}：{{ recipe.cookMinutes }}
      </text>
      <text class="section">
        {{ copy.ingredients }}
      </text>
      <view
        v-for="(item, index) in recipe.ingredients"
        :key="index"
        class="row"
      >
        <text class="block">
          {{ item.raw }}
        </text>
        <text>
          {{ item.name }}<text v-if="item.quantity !== null">
            · {{ item.quantity }} {{ item.unit }}
          </text>
        </text>
        <text
          v-if="item.note"
          class="block"
        >
          {{ item.note }}
        </text>
      </view>
      <text class="section">
        {{ copy.steps }}
      </text>
      <text
        v-for="(step, index) in recipe.steps"
        :key="index"
        class="block"
      >
        {{ index + 1 }}. {{ step }}
      </text>
      <text
        v-if="recipe.tags.length"
        class="block"
      >
        {{ recipe.tags.join(' · ') }}
      </text>
      <button
        data-edit
        @tap="edit"
      >
        {{ copy.editRecipe }}
      </button>
    </view>
    <text
      v-else
      role="status"
    >
      {{ message || copy.checking }}
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
.title { display: block; font-size: 40rpx; margin-bottom: 24rpx; }
.block, .section { display: block; white-space: pre-wrap; margin-top: 20rpx; }
.section { font-size: 32rpx; margin-top: 32rpx; }
.row { padding: 16rpx; margin-top: 12rpx; background: white; }
button { margin-top: 32rpx; }
.recipe-image { width: 100%; height: 400rpx; }
</style>
