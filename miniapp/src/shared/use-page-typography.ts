import { computed, ref } from 'vue';
import { onResize, onShow } from '@dcloudio/uni-app';

export function usePageTypography() {
  const scale = ref(1);
  function refresh() {
    const info = uni.getAppBaseInfo() as ReturnType<typeof uni.getAppBaseInfo> & { fontSizeScaleFactor?: number; fontSizeSetting?: number };
    const standard = uni.getDeviceInfo().platform === 'ios' ? 17 : 16;
    const size = info.fontSizeSetting ?? info.hostFontSizeSetting;
    const factor = info.fontSizeScaleFactor ?? (size ? size / standard : 1);
    // DevTools can report 0.4 at its standard setting; never shrink the 16px baseline.
    scale.value = Number.isFinite(factor) && factor > 0 ? Math.max(1, factor) : 1;
  }
  onShow(refresh); onResize(refresh);
  // Explicit root size is the only scaling source; do not also use root-font-size="system".
  const rootFontSize = computed(() => `${Math.round(16 * scale.value * 100) / 100}px`);
  const singleColumn = computed(() => scale.value > 1);
  return { rootFontSize, singleColumn };
}
