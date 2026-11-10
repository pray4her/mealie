import { defineComponent, getCurrentInstance, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { Component } from 'vue';
import type { AppClient } from 'home-contracts';
import { appClientKey, provideAppClient } from '../../src/shared/app-client';
import { createMemoryStorage } from './sdk-transport';
import type { SessionStorage } from '../../src/shared/session-boundary';
import WdButton from '@wot-ui/ui/components/wd-button/wd-button.vue';
import WdSearch from '@wot-ui/ui/components/wd-search/wd-search.vue';
import WdInput from '@wot-ui/ui/components/wd-input/wd-input.vue';
import WdTextarea from '@wot-ui/ui/components/wd-textarea/wd-textarea.vue';
import WdPopup from '@wot-ui/ui/components/wd-popup/wd-popup.vue';

export function registerHook(name: string, callback: (value: never) => unknown) {
  const instance = getCurrentInstance(); if (!instance) throw new Error('Hook registered outside setup');
  const context = instance as typeof instance & { uniTestHooks?: Record<string, ((value: never) => unknown)[]> };
  const hooks = context.uniTestHooks ??= {}; (hooks[name] ??= []).push(callback);
}
const View = defineComponent({ setup(_, { slots }) { return () => h('div', {}, slots.default?.()); } });
const Text = defineComponent({ setup(_, { slots }) { return () => h('span', {}, slots.default?.()); } });
const Button = defineComponent({ props: { disabled: Boolean, loading: Boolean }, emits: ['tap'], setup(props, { slots, emit }) {
  return () => h('button', { disabled: props.disabled, onClick: () => { if (!props.disabled) emit('tap'); } }, slots.default?.());
} });
const Input = defineComponent({ props: { value: { type: String, default: '' }, modelValue: { type: String, default: undefined }, disabled: Boolean, maxlength: { type: Number, default: 140 } }, emits: ['input', 'update:modelValue', 'confirm'], setup(props, { emit }) {
  return () => h('input', { value: props.modelValue ?? props.value, disabled: props.disabled, maxlength: props.maxlength,
    onInput: (event: Event) => { if (!props.disabled) { const value = (event.target as HTMLInputElement).value; emit('update:modelValue', value); emit('input', { detail: { value } }); } },
    onConfirm: (event: Event) => emit('confirm', { detail: { value: (event.target as HTMLInputElement).value } }),
  });
} });
const Textarea = defineComponent({ props: { value: { type: String, default: '' }, modelValue: { type: String, default: undefined }, disabled: Boolean, maxlength: { type: Number, default: 140 } }, emits: ['input', 'update:modelValue'], setup(props, { emit }) {
  return () => h('textarea', { value: props.modelValue ?? props.value, disabled: props.disabled, maxlength: props.maxlength,
    onInput: (event: Event) => { if (!props.disabled) { const value = (event.target as HTMLTextAreaElement).value; emit('update:modelValue', value); emit('input', { detail: { value } }); } },
  });
} });
export function mountPage(component: Component, { client, storage = createMemoryStorage(), controllers }: { client: AppClient; storage?: SessionStorage; controllers?: ReturnType<typeof provideAppClient> }) {
  const platform = { ...uni };
  Object.assign(uni, { getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, screenHeight: 844, safeAreaInsets: { bottom: 0 }, fontSizeSetting: 16 }), getDeviceInfo: () => ({}), getAppBaseInfo: () => ({ fontSizeSetting: 16 }), getWindowInfo: () => ({ windowWidth: 390, screenHeight: 844, safeAreaInsets: { bottom: 0 } }) }, platform);
  let context!: ReturnType<typeof provideAppClient>; let request = 0; const navigation: string[] = [];
  const wrapper = mount(component, { global: { plugins: [{ install(app) {
    if (controllers) { context = controllers; app.provide(appClientKey, controllers); }
    else context = provideAppClient(app, client, { storage, newRequestId: async () => `fixture-request-${++request}` });
  } }], components: { WdButton, WdSearch, WdInput, WdTextarea, WdPopup }, stubs: { UniView: View, UniText: Text, UniButton: Button, UniInput: Input, UniTextarea: Textarea } } });
  const hooks = (wrapper.vm.$ as typeof wrapper.vm.$ & { uniTestHooks?: Record<string, ((value: never) => unknown)[]> }).uniTestHooks ?? {};
  async function drive(name: string, value?: unknown) { let result: unknown; for (const fn of hooks[name] ?? []) result = await fn(value as never); await flushPromises(); return result; }
  const unmount = wrapper.unmount.bind(wrapper); wrapper.unmount = () => { if (!controllers) { context.imports.dispose(); context.recipes.dispose(); context.media.dispose(); context.membership.dispose(); context.family.dispose(); context.invitations.dispose(); } unmount(); };
  return { wrapper, controllers: context, auth: context.auth, family: context.family, navigation, show: () => drive('show'), hide: () => drive('hide'), unload: () => drive('unload'), load: (query: Record<string, string>) => drive('load', query), share: () => drive('share') as Promise<{ title: string; path: string; imageUrl: string }> };
}
