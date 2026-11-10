// @vitest-environment jsdom
/* eslint vue/one-component-per-file: "off" -- Each test mounts an independent page fixture. */
import { expect, test } from 'vitest';
import { defineComponent, h, ref, resolveComponent } from 'vue';
import { mountPage } from '../support/uni-stubs';
import { createHarness } from '../support/harness';

test('wot_button_double_suppresses_click_while_disabled_or_loading', async () => {
  const disabled = ref(false); const loading = ref(false); const count = ref(0);
  const Page = defineComponent({ setup() { return () => h('div', [
    h(resolveComponent('wd-button'), { disabled: disabled.value, loading: loading.value, onClick: () => count.value++ }, () => '提交'),
    h('output', String(count.value)),
  ]); } });
  const page = mountPage(Page, { client: createHarness().client('alice') });
  await page.wrapper.get('button').trigger('click'); expect(page.wrapper.get('output').text()).toBe('1');
  disabled.value = true; await page.wrapper.vm.$nextTick(); await page.wrapper.get('button').trigger('click');
  loading.value = true; disabled.value = false; await page.wrapper.vm.$nextTick(); await page.wrapper.get('button').trigger('click');
  expect(page.wrapper.get('output').text()).toBe('1'); page.wrapper.unmount();
});

test.each(['wd-input', 'wd-textarea'])('%s_double_binds_value_and_emits_unwrapped_input_and_confirm_payloads', async tag => {
  const value = ref('原文'); const disabled = ref(false); const received = ref(''); const confirmed = ref('');
  const Page = defineComponent({ setup() { return () => h('div', [
    h(resolveComponent(tag), { modelValue: value.value, disabled: disabled.value,
      'onUpdate:modelValue': (next: string) => { value.value = next; },
      onInput: (event: { value: string }) => { received.value = event.value; },
      onConfirm: (event: { value: string }) => { confirmed.value = event.value; },
    }), h('output', `${value.value}/${received.value}/${confirmed.value}`),
  ]); } });
  const page = mountPage(Page, { client: createHarness().client('alice') });
  const input = page.wrapper.get(tag === 'wd-input' ? 'input' : 'textarea');
  expect((input.element as HTMLInputElement).value).toBe('原文');
  await input.setValue('新内容'); await input.trigger('confirm'); expect(page.wrapper.get('output').text()).toBe('新内容/新内容/新内容');
  value.value = '恢复内容'; await page.wrapper.vm.$nextTick(); expect((input.element as HTMLInputElement).value).toBe('恢复内容');
  disabled.value = true; await page.wrapper.vm.$nextTick(); await input.setValue('不应修改'); await input.trigger('confirm');
  expect(page.wrapper.get('output').text()).toBe('恢复内容/新内容/新内容'); page.wrapper.unmount();
});

test('wot_action_sheet_double_selects_enabled_actions_and_updates_visibility_on_select_or_cancel', async () => {
  const open = ref(true); const selected = ref(''); const cancelled = ref(false);
  const actions = [{ name: '禁用', disabled: true }, { name: '处理中', loading: true }, { name: '手动创建' }];
  const Page = defineComponent({ setup() { return () => h('div', [
    h(resolveComponent('wd-action-sheet'), { modelValue: open.value, actions, cancelText: '取消',
      'onUpdate:modelValue': (value: boolean) => { open.value = value; },
      onSelect: ({ item, index }: { item: { name: string }; index: number }) => { selected.value = `${index}:${item.name}`; },
      onCancel: () => { cancelled.value = true; },
    }), h('output', `${open.value}/${selected.value}/${cancelled.value}`),
  ]); } });
  const page = mountPage(Page, { client: createHarness().client('alice') });
  await page.wrapper.get('[data-action="0"]').trigger('click'); await page.wrapper.get('[data-action="1"]').trigger('click');
  expect(page.wrapper.get('output').text()).toBe('true//false');
  await page.wrapper.get('[data-action="2"]').trigger('click'); expect(page.wrapper.get('output').text()).toBe('false/2:手动创建/false');
  expect(page.wrapper.find('[role="dialog"]').exists()).toBe(false);
  open.value = true; await page.wrapper.vm.$nextTick(); await page.wrapper.get('[data-cancel]').trigger('click');
  expect(page.wrapper.get('output').text()).toBe('false/2:手动创建/true'); page.wrapper.unmount();
});
