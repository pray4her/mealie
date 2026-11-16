import { computed, reactive, ref, watch } from 'vue';
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app';
import type { FormInstance, FormSchema } from '@wot-ui/ui/components/wd-form/types';
import type { ShoppingIntent } from 'home-contracts';
import type { FieldIssue } from '../recipes/validation';
import { useFieldIssues } from '../../shared/use-field-issues';
import { useLeaveGuard } from '../../shared/use-leave-guard';
import { useShoppingPage } from './use-shopping-page';
import { id, itemFields, text } from './validation';
import { entityKey } from './use-shopping';

const blank = () => ({ name: '', raw: '', quantity: '', unit: '', note: '' });
export function useShoppingEditor(kind: 'list' | 'item') {
  const draft = ref(blank()); const baseline = ref(JSON.stringify(draft.value)); const form = ref<FormInstance>(); const fields = reactive(useFieldIssues());
  const targetId = ref<string | null>(null); const listId = ref<string | null>(null); const ready = ref(false); const invalid = ref(false); const savedName = ref('');
  const committed = ref<'saved' | 'removed' | null>(null); let version = 1; let initialized: string | null = null; let attempt: string | null = null; let visibility = 0;
  const page = useShoppingPage(initialize);
  const entity = computed(() => kind === 'list' ? 'list:' + (targetId.value ?? 'new') : 'item:' + listId.value + ':' + (targetId.value ?? 'new'));
  const original = computed(() => page.shopping.pending.value.find(row => entityKey(row) === entity.value));
  const locked = computed(() => page.busy.value || !!page.shopping.busy.value[entity.value] || !!original.value || !!committed.value);
  const leave = useLeaveGuard(() => !committed.value && JSON.stringify(draft.value) !== baseline.value, page.isCurrent, () => page.draftScope.value ?? '');
  const definitions = kind === 'list' ? [{ key: 'name' as const, label: '清单名称', max: 40, multiline: false, required: true }]
    : [{ key: 'raw' as const, label: '条目原文', max: 500, multiline: true, required: true }, { key: 'name' as const, label: '名称（可选）', max: 100, multiline: false },
      { key: 'quantity' as const, label: '数量（未知请留空）', max: 30, multiline: false }, { key: 'unit' as const, label: '单位（可选）', max: 40, multiline: false }, { key: 'note' as const, label: '备注（可选）', max: 500, multiline: true }];
  function currentAction() { const showing = visibility; const revision = page.revision(); const scope = page.draftScope.value; return () => showing === visibility && revision === page.revision() && scope === page.draftScope.value && page.isCurrent(); }
  function apply(input: Partial<ReturnType<typeof blank>>) { draft.value = { ...blank(), ...input }; baseline.value = JSON.stringify(draft.value); fields.errors = {}; fields.focused = ''; form.value?.reset(); }
  function applyIntent(command: ShoppingIntent) {
    attempt = command.input.requestId;
    if ('version' in command.input) version = command.input.version;
    if ('item' in command.input) { const row = command.input.item; apply({ raw: row.raw, name: row.name ?? '', quantity: row.quantity?.toString() ?? '', unit: row.unit ?? '', note: row.note ?? '' }); }
    else if ('name' in command.input) apply({ name: command.input.name });
  }
  async function initialize(force = false) {
    if (invalid.value) { page.message.value = '清单参数无效，请返回重新选择。'; return; }
    if (initialized === page.draftScope.value && ready.value && !force) return;
    initialized = page.draftScope.value; const current = currentAction();
    if (kind === 'item') {
      const parent = await page.shopping.getList(listId.value!); if (!current() || !parent) return; savedName.value = parent.name;
    }
    if (targetId.value) {
      if (kind === 'list') { const row = await page.shopping.getList(targetId.value); if (!current() || !row) return; version = row.version; savedName.value = row.name; apply({ name: row.name }); }
      else { const row = await page.shopping.getItem(listId.value!, targetId.value); if (!current() || !row) return; version = row.version; savedName.value = row.name ?? row.raw; apply({ ...row, name: row.name ?? '', quantity: row.quantity?.toString() ?? '', unit: row.unit ?? '', note: row.note ?? '' }); }
    } else apply({});
    if (original.value) applyIntent(original.value); ready.value = true;
  }
  watch(page.draftScope, value => { if (initialized && initialized !== value) { visibility++; initialized = null; ready.value = false; committed.value = null; attempt = null; savedName.value = ''; apply({}); } }, { flush: 'sync' });
  watch(original, value => { if (value) attempt = value.input.requestId; }, { flush: 'sync' });
  watch(page.shopping.confirmed, value => {
    if (!value || value.requestId !== attempt || !page.isCurrent()) return;
    committed.value = value.kind === 'removeList' || value.kind === 'removeItem' ? 'removed' : 'saved'; baseline.value = JSON.stringify(draft.value); leave.disable();
  }, { flush: 'sync' });
  onHide(() => { visibility++; }); onUnload(() => { visibility++; apply({}); });
  onLoad(query => { try { if (query?.id !== undefined) targetId.value = id(query.id); if (kind === 'item') listId.value = id(query?.listId); } catch { invalid.value = true; } });
  function number() { const raw = draft.value.quantity.trim(); if (!raw) return null; if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error(); const value = Number(raw); if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new Error(); return value; }
  const nullable = (value: string) => value.trim() ? value : null;
  const item = () => itemFields({ raw: draft.value.raw, name: nullable(draft.value.name), quantity: number(), unit: nullable(draft.value.unit), note: nullable(draft.value.note) });
  function issues(): FieldIssue[] {
    const result: FieldIssue[] = [];
    for (const field of definitions) {
      try {
        const value = draft.value[field.key];
        if (field.key === 'quantity') number(); else if (field.required || value.trim()) text(value, field.max, field.multiline);
      } catch { result.push({ path: [field.key], message: field.key === 'quantity' ? '数量须大于 0 且不超过 1000000；未知请留空。' : `${field.label}需为有效文本，最多 ${field.max} 字。` }); }
    }
    return result;
  }
  const schema: FormSchema = { validate: () => issues() };
  function change(key: keyof ReturnType<typeof blank>, value: string) { if (!locked.value && page.isCurrent()) { draft.value[key] = value; fields.clear(key); form.value?.reset(); } }
  async function validateField(key: string) { await form.value?.validate(key); const issue = issues().find(row => row.path[0] === key); if (issue) fields.errors[key] = issue.message; else fields.clear(key); }
  async function save() {
    await page.act(async current => {
      if (!ready.value || original.value || committed.value) return;
      await form.value?.validate(); if (!current()) return; const found = issues(); fields.set(found, path => String(path[0]));
      if (found.length) { page.message.value = '请检查标出的字段。'; await fields.reveal(); return; }
      if (kind === 'list') {
        if (targetId.value) await page.shopping.write('renameList', { id: targetId.value, version, name: draft.value.name });
        else await page.shopping.write('createList', { name: draft.value.name });
      } else if (targetId.value) await page.shopping.write('updateItem', { id: targetId.value, listId: listId.value!, version, item: item() });
      else await page.shopping.write('addItem', { listId: listId.value!, item: item() });
    });
  }
  async function remove() {
    await page.act(async current => {
      if (!targetId.value || original.value || committed.value) return;
      const accepted = await leave.confirm({ title: kind === 'list' ? '删除整张清单？' : '删除条目？', content: kind === 'list'
        ? `删除「${savedName.value}」后，清单及其中全部条目将无法再访问，不能撤销。` : `删除「${savedName.value}」后无法恢复。`, confirmText: '确认删除' }, true);
      if (!accepted || !current()) return;
      if (kind === 'list') await page.shopping.write('removeList', { id: targetId.value, version });
      else await page.shopping.write('removeItem', { listId: listId.value!, id: targetId.value, version });
    });
  }
  const retry = () => page.act(async () => { if (original.value) { attempt = original.value.input.requestId; await page.shopping.retry(attempt); } });
  const reload = () => page.act(async current => { if (original.value || committed.value) return; if (await leave.confirm({ title: '重新加载？', content: '当前未保存的输入将丢失，并读取家人最新保存的内容。', confirmText: '重新加载' }) && current()) await initialize(true); });
  const back = () => page.act(async current => { if (await leave.confirm() && current()) page.back(); });
  return { page, draft, form, fields, schema, definitions, targetId, ready, committed, locked, original, save, remove, retry, reload, back, change, validateField };
}
