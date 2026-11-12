<script setup lang="ts">
import HomeAction from '../../components/HomeAction.vue';
import { usePageTypography } from '../../shared/use-page-typography';
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { validId } from '../../features/recipes/validation';
import { AppError, errorCode } from '../../shared/errors';
import { copy } from '../../shared/copy';
const { rootFontSize } = usePageTypography();
const id = ref<string | null>(null);
onLoad(query => { try { id.value = validId(query?.id); } catch { id.value = null; } });
const mediaMessage = ref('');
const failedImages = ref<Record<string, boolean>>({});
const page = useRecipesPage(async () => {
  mediaMessage.value = ''; if (!id.value) throw new AppError('INVALID_INPUT');
  const value = await page.recipes.get(id.value); if (value) await loadImages();
});
async function loadImages() {
  mediaMessage.value = ''; failedImages.value = {};
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
const imageLabels = computed(() => Object.fromEntries(images.value.map(image => [image.mediaId, imageState[image.state]] as const)));
function failImage(mediaId: string) {
  failedImages.value[mediaId] = true; mediaMessage.value = '图片加载失败，菜谱内容仍可阅读。';
}
const edit = () => { if (recipe.value) uni.navigateTo({ url: '/pages/recipes/edit?id=' + recipe.value.id }); };
</script>
<template>
  <page-meta :root-font-size="rootFontSize" />
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
        v-for="(mediaId, imageIndex) in recipe.imageIds"
        :key="mediaId"
        class="photo"
        :class="{ 'photo--thumbnail': mediaId !== recipe.imageIds[0] }"
      >
        <image
          v-if="imageLinks[mediaId] && !failedImages[mediaId]"
          data-recipe-image
          :src="imageLinks[mediaId].url"
          mode="aspectFit"
          class="recipe-image"
          :aria-label="'预览菜谱图片 ' + (imageIndex + 1)"
          role="button"
          aria-role="button"
          tabindex="0"
          @tap="page.act(async () => { await media.preview(mediaId); })"
          @keydown.enter.prevent="page.act(async () => { await media.preview(mediaId); })"
          @keydown.space.prevent="page.act(async () => { await media.preview(mediaId); })"
          @error="failImage(mediaId)"
        />
        <text
          v-else
          class="status"
        >
          {{ failedImages[mediaId] ? '图片加载失败' : imageLabels[mediaId] || (mediaMessage ? '图片加载失败' : '图片加载中') }}
        </text>
      </view>
      <view
        v-if="mediaMessage"
        class="status"
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <text>{{ mediaMessage }}</text>
        <HomeAction
          label="重试图片"
          data-retry-images
          type="info"
          @click="page.act(loadImages)"
        >
          重试图片
        </HomeAction>
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
      <text
        class="title"
        role="heading"
        aria-role="heading"
        aria-level="1"
      >
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
      <view class="actions">
        <HomeAction
          :label="recipe.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe"
          data-favorite
          type="info"
          :disabled="busy || !!pendingFavorite"
          :pressed="recipe.isFavorite"
          @click="page.act(async () => { if (recipe) await recipes.favorite(recipe.id, !recipe.isFavorite); })"
        >
          {{ recipe.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
        </HomeAction>
        <HomeAction
          :label="copy.editRecipe"
          data-edit
          @click="edit"
        >
          {{ copy.editRecipe }}
        </HomeAction>
      </view>

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
          {{ item.quantity === null ? '未注明数量' : item.quantity }}<text v-if="item.unit">
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
        <text
          role="status"
          aria-role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ copy.pendingFavorite }}
        </text>
        <HomeAction
          :label="copy.resumeFavorite"
          data-resume-favorite
          :disabled="busy"
          @click="page.act(async () => { await recipes.retryFavorite(); })"
        >
          {{ copy.resumeFavorite }}
        </HomeAction>
      </view>
      <text
        v-if="message"
        class="status error"
        role="status"
        aria-role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ message }}
      </text>
    </view>
    <text
      v-else
      class="status"
      role="status"
      aria-role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ message || copy.checking }}
    </text>
    <HomeAction
      v-if="message"
      :label="copy.retry"
      data-retry
      type="info"
      @click="page.check"
    >
      {{ copy.retry }}
    </HomeAction>
    <HomeAction
      label="返回菜谱"
      type="info"
      variant="text"
      @click="page.back"
    >
      返回菜谱
    </HomeAction>
  </view>
</template>
<style scoped>
.detail-page { background: var(--home-surface); }
.photo { display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; background: var(--home-bg); color: var(--home-muted); border-radius: 12px; overflow: hidden; }
.photo--thumbnail { display: inline-flex; vertical-align: top; width: 80px; height: 80px; aspect-ratio: 1; margin: 12px 12px 0 0; }
.recipe-image { display: block; width: 100%; height: 100%; }
.empty-image { display: flex; align-items: center; justify-content: center; min-height: 160px; background: var(--home-bg); color: var(--home-muted); border-radius: 12px; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 12px; }
.tag { background: var(--home-selected); color: var(--home-primary); padding: 4px 10px; border-radius: 8px; font-size: .875rem; }
.facts { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 16px 0; font-size: .875rem; }
.description { margin-top: 24px; line-height: 1.8; }
.ingredient { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--home-line); }
.ingredient-copy { flex: 1; min-width: 140px; }
.amount { text-align: right; }
.step { display: flex; gap: 16px; padding: 12px 0; line-height: 1.85; white-space: pre-wrap; }
.step-number { color: var(--home-primary); font-weight: 600; min-width: 24px; }
.step-copy { flex: 1; min-width: 0; }
</style>
