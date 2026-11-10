<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { validId } from '../../features/recipes/validation';
import { AppError, errorCode } from '../../shared/errors';
import { copy } from '../../shared/copy';
const id = ref<string | null>(null);
onLoad(query => { try { id.value = validId(query?.id); } catch { id.value = null; } });
const mediaMessage = ref('');
const page = useRecipesPage(async () => {
  mediaMessage.value = ''; if (!id.value) throw new AppError('INVALID_INPUT');
  const value = await page.recipes.get(id.value); if (value) await loadImages();
});
async function loadImages() {
  mediaMessage.value = '';
  try { if (page.recipes.recipe.value) await page.media.initialize(page.recipes.recipe.value); }
  catch (error) {
    if (['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'FORBIDDEN'].includes(errorCode(error))) throw error;
    if (page.recipes.recipe.value) mediaMessage.value = '图片加载失败，菜谱内容仍可阅读。';
  }
}
const { confirmed, busy, message, recipes, media } = page;
const { items: images, links: imageLinks } = media;
const { recipe, pendingFavorite } = recipes;
const imageState = { requested: '图片尚未上传', uploading: '图片上传中', uploaded: '图片待校验', checking: '图片校验中', pending: '图片审核中', ready: '图片暂不可用', rejected: '图片审核未通过', 'review-error': '图片审核异常', failed: '图片上传失败' };
const edit = () => { if (recipe.value) uni.navigateTo({ url: '/pages/recipes/edit?id=' + recipe.value.id }); };
</script>
<template>
  <view class="page detail-page">
    <view
      v-if="confirmed && recipe"
      data-protected
    >
      <view
        v-if="!recipe.imageIds.length"
        class="empty-image"
      >
        暂无图片
      </view>
      <view
        v-for="image in images"
        :key="image.mediaId"
        class="photo"
      >
        <image
          v-if="imageLinks[image.mediaId] && !mediaMessage"
          data-recipe-image
          :src="imageLinks[image.mediaId].url"
          mode="aspectFit"
          class="recipe-image"
          aria-label="预览菜谱图片"
          @tap="page.act(async () => { await media.preview(image.mediaId); })"
          @error="mediaMessage = '图片加载失败，菜谱内容仍可阅读。'"
        />
        <text
          v-else
          class="status"
        >
          {{ imageState[image.state] }}
        </text>
      </view>
      <view
        v-if="mediaMessage"
        class="status"
        role="status"
      >
        <text>{{ mediaMessage }}</text>
        <wd-button
          data-retry-images
          type="info"
          @click="page.act(loadImages)"
        >
          重试图片
        </wd-button>
      </view>
      <view
        v-if="recipe.tags.length"
        class="tags"
      >
        <text
          v-for="tag in recipe.tags"
          :key="tag"
          class="tag"
        >
          {{ tag }}
        </text>
      </view>
      <text class="title">
        {{ recipe.title }}
      </text>
      <text class="muted">
        {{ recipe.authorLabel }}
      </text>
      <view class="facts">
        <text v-if="recipe.baseServings !== null">
          {{ copy.servings }}：{{ recipe.baseServings }}
        </text>
        <text v-if="recipe.prepMinutes !== null">
          {{ copy.prepMinutes }}：{{ recipe.prepMinutes }}
        </text>
        <text v-if="recipe.cookMinutes !== null">
          {{ copy.cookMinutes }}：{{ recipe.cookMinutes }}
        </text>
        <text v-if="recipe.prepMinutes !== null && recipe.cookMinutes !== null">
          总时长：{{ recipe.prepMinutes + recipe.cookMinutes }} 分钟
        </text>
      </view>
      <text
        v-if="recipe.description"
        class="block description"
      >
        {{ recipe.description }}
      </text>
      <text class="section">
        {{ copy.ingredients }}
      </text>
      <view
        v-for="(item, index) in recipe.ingredients"
        :key="index"
        class="ingredient"
      >
        <view class="ingredient-copy">
          <text class="block">
            {{ item.name }}
          </text>
          <text class="block muted">
            {{ item.raw }}
          </text>
          <text
            v-if="item.note"
            class="block"
          >
            {{ item.note }}
          </text>
        </view>
        <text class="amount">
          {{ item.quantity === null ? '适量 / 未注明' : item.quantity }}<text v-if="item.unit">
            {{ item.unit }}
          </text>
        </text>
      </view>
      <text class="section">
        {{ copy.steps }}
      </text>
      <view
        v-for="(step, index) in recipe.steps"
        :key="index"
        class="step"
      >
        <text class="step-number">
          {{ index + 1 }}
        </text><text class="step-copy">
          {{ step }}
        </text>
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
      <text
        v-if="message"
        class="status error"
        role="status"
      >
        {{ message }}
      </text>
      <view class="actions">
        <wd-button
          data-favorite
          type="info"
          :disabled="busy || !!pendingFavorite"
          :aria-disabled="busy || !!pendingFavorite"
          :aria-pressed="recipe.isFavorite"
          @click="page.act(async () => { if (recipe) await recipes.favorite(recipe.id, !recipe.isFavorite); })"
        >
          {{ recipe.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
        </wd-button>
        <wd-button
          data-edit
          @click="edit"
        >
          {{ copy.editRecipe }}
        </wd-button>
      </view>
    </view>
    <text
      v-else
      class="status"
      role="status"
    >
      {{ message || copy.checking }}
    </text>
    <wd-button
      v-if="message"
      data-retry
      type="info"
      @click="page.check"
    >
      {{ copy.retry }}
    </wd-button>
    <wd-button
      type="info"
      variant="text"
      @click="page.back"
    >
      返回菜谱
    </wd-button>
  </view>
</template>
<style scoped>
.detail-page { background: var(--home-surface); }
.recipe-image { width: 100%; height: 260px; border-radius: 12px; }
.empty-image { display: flex; align-items: center; justify-content: center; min-height: 160px; background: var(--home-bg); color: var(--home-muted); border-radius: 12px; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 12px; }
.tag { background: var(--home-selected); color: var(--home-primary); padding: 4px 10px; border-radius: 8px; font-size: 14px; }
.facts { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 16px 0; font-size: 14px; }
.description { margin-top: 24px; line-height: 1.8; }
.ingredient { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--home-line); }
.ingredient-copy { flex: 1; min-width: 140px; }
.amount { text-align: right; }
.step { display: flex; gap: 16px; padding: 12px 0; line-height: 1.85; white-space: pre-wrap; }
.step-number { color: var(--home-primary); font-weight: 600; min-width: 24px; }
.step-copy { flex: 1; min-width: 0; }
</style>
