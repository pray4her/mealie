import { nextTick, ref } from 'vue';
import type { FieldIssue } from '../features/recipes/validation';

export function useFieldIssues() {
  const errors = ref<Record<string, string>>({}); const focused = ref('');
  function clear(id: string) { delete errors.value[id]; focused.value = ''; }
  function set(issues: FieldIssue[], identify: (path: FieldIssue['path']) => string) {
    errors.value = {};
    for (const issue of issues) errors.value[identify(issue.path)] ??= issue.message;
  }
  async function reveal(id = Object.keys(errors.value)[0]) {
    if (!id) return;
    focused.value = ''; await nextTick(); focused.value = id;
    try { uni.pageScrollTo?.({ selector: '#' + id, duration: 180, fail: () => {} }); } catch { /* Native focus still locates the field when scrolling is unavailable. */ }
  }
  return { errors, focused, clear, set, reveal };
}
