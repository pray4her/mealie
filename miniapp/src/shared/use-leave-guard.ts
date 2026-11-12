import { watch, onBeforeUnmount } from 'vue';
import { onShow, onHide, onUnload } from '@dcloudio/uni-app';

export function useLeaveGuard(dirty: () => boolean, current: () => boolean, scope: () => string) {
  let active = false; let generation = 0;
  function disable() {
    if (!active) return;
    try { uni.disableAlertBeforeUnload?.({ fail: () => {} }); } catch { /* Older clients do not provide the native return alert. */ }
  }
  function sync() {
    if (!active) return;
    if (!dirty()) { disable(); return; }
    try { uni.enableAlertBeforeUnload?.({ message: '尚有未保存的输入，离开后将丢失。', fail: () => {} }); } catch { /* Application navigation still uses confirmation. */ }
  }
  async function confirm(options: { title?: string; content?: string; confirmText?: string } = {}, always = false) {
    if (!active || !current()) return false;
    if (!dirty() && !always) { disable(); return true; }
    const initialScope = scope(); const initialGeneration = generation;
    if (dirty() || always) {
      try {
        const result = await uni.showModal({ title: '放弃未保存的输入？', content: '离开后，当前输入不会保留。', confirmText: '放弃离开', cancelText: '继续编辑', ...options });
        if (!result.confirm) return false;
      } catch { return false; }
    }
    if (!active || generation !== initialGeneration || !current() || scope() !== initialScope) return false;
    disable(); return true;
  }
  function conceal() { disable(); active = false; generation++; }
  watch(dirty, sync, { flush: 'sync' }); onShow(() => { active = true; generation++; sync(); }); onHide(conceal); onUnload(conceal); onBeforeUnmount(conceal);
  return { confirm, sync, disable };
}
