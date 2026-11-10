<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useRecipesPage } from '../../features/recipes/use-recipes-page';
import { validId } from '../../features/recipes/validation';
import type { Cover } from '../../features/recipes/use-recipe-covers';
import PrivateImage from '../../components/PrivateImage.vue';
import { AppError } from '../../shared/errors';
import { copy } from '../../shared/copy';
const id = ref<string | null>(null);
onLoad(query => { try { id.value = validId(query?.id); } catch { id.value = null; } });
const page = useRecipesPage(async () => { if (!id.value) throw new AppError('INVALID_INPUT'); const recipe = await page.recipes.get(id.value); if (recipe) await page.media.initialize(recipe); });
const { confirmed, busy, message, recipes, media } = page;
const { recipe, pendingFavorite } = recipes;
const edit = () => { if (recipe.value) uni.navigateTo({ url: '/pages/recipes/edit?id=' + recipe.value.id }); };
function cover(mediaId: string): Cover {
  return { state: media.linkErrors.value[mediaId] ?? media.items.value.find(item => item.mediaId === mediaId)?.state ?? 'loading', url: media.links.value[mediaId]?.url };
}
</script>
<template>
  <view class="page">
    <view
      v-if="confirmed && recipe"
      data-protected
    >
      <view class="detail-actions">
        <wd-button
          variant="text"
          @click="page.back"
        >
          {{ copy.back }}
        </wd-button>
        <wd-button
          data-edit
          variant="text"
          :disabled="busy"
          @click="edit"
        >
          {{ copy.editRecipe }}
        </wd-button>
        <wd-button
          data-favorite
          variant="text"
          :disabled="busy || !!pendingFavorite"
          :aria-pressed="recipe.isFavorite"
          @click="page.act(async () => { if (recipe) await recipes.favorite(recipe.id, !recipe.isFavorite); })"
        >
          {{ recipe.isFavorite ? copy.unfavoriteRecipe : copy.favoriteRecipe }}
        </wd-button>
      </view>
      <view class="gallery">
        <PrivateImage
          v-if="!recipe.imageIds.length"
          :label="recipe.title + '的菜图'"
        />
        <PrivateImage
          v-for="mediaId in recipe.imageIds"
          :key="mediaId"
          :cover="cover(mediaId)"
          :label="recipe.title + '的菜图'"
          :busy="busy"
          preview
          @error="media.failLink(mediaId)"
          @retry="page.act(async () => { await media.refresh(); })"
          @open="page.act(async () => { await media.preview(mediaId); })"
        />
      </view>
      <view class="detail-body">
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
        <text class="author">
          {{ recipe.authorLabel }}
        </text>
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
        <text
          v-if="message"
          class="notice"
          role="status"
        >
          {{ message }}
        </text>
        <view class="facts">
          <view>
            <text class="fact-label">
              份数
            </text><text>{{ recipe.baseServings ?? '未记录' }}</text>
          </view>
          <view>
            <text class="fact-label">
              准备时间
            </text><text>{{ recipe.prepMinutes === null ? '未记录' : recipe.prepMinutes + ' 分钟' }}</text>
          </view>
          <view>
            <text class="fact-label">
              烹饪时间
            </text><text>{{ recipe.cookMinutes === null ? '未记录' : recipe.cookMinutes + ' 分钟' }}</text>
          </view>
        </view>
        <text
          v-if="recipe.description"
          class="description"
        >
          {{ recipe.description }}
        </text>
        <text class="section">
          {{ copy.ingredients }}
        </text>
        <view
          v-for="(item, index) in recipe.ingredients"
          :key="index"
          class="ingredient-row"
        >
          <view class="ingredient-main">
            <text class="ingredient-name">
              {{ item.name }}
            </text><text class="quantity">
              {{ item.quantity === null ? '数量未记录' : item.quantity }}{{ item.unit ? ' ' + item.unit : '' }}
            </text>
          </view>
          <text class="ingredient-raw">
            原文：{{ item.raw }}
          </text>
          <text
            v-if="item.note"
            class="ingredient-note"
          >
            处理备注：{{ item.note }}
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
          </text><text class="step-text">
            {{ step }}
          </text>
        </view>
      </view>
    </view>
    <view
      v-else
      class="detail-body"
    >
      <text
        class="notice"
        role="status"
      >
        {{ message || copy.checking }}
      </text><wd-button
        variant="text"
        @click="page.back"
      >
        {{ copy.back }}
      </wd-button>
    </view>
    <wd-button
      v-if="message"
      data-retry
      :disabled="busy"
      @click="page.check"
    >
      {{ copy.retry }}
    </wd-button>
  </view>
</template>
<style scoped>
.page { background: var(--app-surface); min-height: 100vh; padding-bottom: calc(24px + env(safe-area-inset-bottom)); }
.detail-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--app-border); }
.gallery { display: flex; flex-direction: column; gap: 12px; }
.detail-body { padding: 24px 20px; }
.title { display: block; font-size: 25px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.author, .fact-label, .ingredient-raw, .ingredient-note { display: block; color: var(--app-text-secondary); font-size: 14px; }
.author { margin-top: 12px; }
.tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.tag { padding: 4px 8px; border-radius: 6px; background: var(--app-selected); color: var(--app-primary); font-size: 14px; overflow-wrap: anywhere; }
.facts { display: flex; flex-wrap: wrap; gap: 16px 24px; margin: 24px 0; padding: 16px 0; border-top: 1px solid var(--app-border); border-bottom: 1px solid var(--app-border); }
.facts > view { flex: 1; min-width: 88px; }
.fact-label { margin-bottom: 4px; }
.description, .step-text { display: block; white-space: pre-wrap; line-height: 1.85; overflow-wrap: anywhere; }
.section { display: block; font-size: 18px; font-weight: 600; margin: 28px 0 12px; }
.ingredient-row { padding: 12px 0; border-bottom: 1px solid var(--app-border); }
.ingredient-main { display: flex; gap: 16px; justify-content: space-between; }
.ingredient-name { min-width: 0; overflow-wrap: anywhere; }
.quantity { text-align: right; max-width: 45%; overflow-wrap: anywhere; }
.ingredient-raw, .ingredient-note { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 4px; }
.step { display: flex; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--app-border); }
.step-number { flex: none; width: 28px; height: 28px; text-align: center; line-height: 28px; border-radius: 50%; background: var(--app-selected); color: var(--app-primary); font-size: 14px; }
.step-text { flex: 1; min-width: 0; font-size: 17px; }
.notice { display: block; margin: 16px 0; }
@media (max-width: 340px) { .detail-body { padding: 20px 16px; } }
</style>
