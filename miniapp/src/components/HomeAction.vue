<script setup lang="ts">
import WdButton from '@wot-ui/ui/components/wd-button/wd-button.vue';
import type { ButtonType, ButtonVariant } from '@wot-ui/ui/components/wd-button/types';
defineOptions({ options: { virtualHost: true, addGlobalClass: true, styleIsolation: 'shared' } });
const props = withDefaults(defineProps<{ label: string; disabled?: boolean; loading?: boolean; pressed?: boolean; type?: ButtonType; variant?: ButtonVariant; block?: boolean; customClass?: string; appearance?: 'button' | 'text' | 'icon'; icon?: string }>(), { pressed: undefined, type: undefined, variant: undefined, customClass: '', appearance: undefined, icon: undefined });
const emit = defineEmits<{ click: [] }>();
function activate() { if (!props.disabled && !props.loading) emit('click'); }
</script>

<template>
  <!-- Wot 2.4.0 drops inherited ARIA in WeChat; expose one named native target and hide its visual child. -->
  <view
    class="home-action"
    :class="[customClass, 'home-action--' + (appearance || (variant === 'text' ? 'text' : 'button')), { 'home-action--block': block }]"
    role="button"
    aria-role="button"
    :aria-label="label"
    :aria-disabled="!!(disabled || loading)"
    :aria-busy="!!loading"
    :aria-pressed="pressed"
    :tabindex="disabled || loading ? -1 : 0"
    @click="activate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent="activate"
  >
    <view
      class="home-action__visual"
      aria-hidden="true"
      inert
    >
      <wd-button
        :type="type"
        :variant="variant || (type === 'info' ? 'plain' : undefined)"
        :block="block"
        :custom-class="customClass"
        :disabled="disabled"
        :loading="loading"
        :icon="icon"
        @click.stop="activate"
      >
        <slot />
      </wd-button>
    </view>
  </view>
</template>
