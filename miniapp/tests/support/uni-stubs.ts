import { defineComponent, getCurrentInstance, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { Component } from 'vue';
import type { AppClient } from 'home-contracts';
import { appClientKey, provideAppClient } from '../../src/shared/app-client';
import { createMemoryStorage } from './sdk-transport';
import type { SessionStorage } from '../../src/shared/session-boundary';

export function registerHook(name: string, callback: () => unknown) {
  const instance = getCurrentInstance(); if (!instance) throw new Error('Hook registered outside setup');
  const context = instance as typeof instance & { uniTestHooks?: Record<string, (() => unknown)[]> };
  const hooks = context.uniTestHooks ??= {}; (hooks[name] ??= []).push(callback);
}
const View = defineComponent({ setup(_, { slots }) { return () => h('div', {}, slots.default?.()); } });
const Text = defineComponent({ setup(_, { slots }) { return () => h('span', {}, slots.default?.()); } });
const Button = defineComponent({ props: { disabled: Boolean, loading: Boolean }, emits: ['tap'], setup(props, { slots, emit }) {
  return () => h('button', { disabled: props.disabled, onClick: () => { if (!props.disabled) emit('tap'); } }, slots.default?.());
} });
const Input = defineComponent({ props: { value: { type: String, default: '' }, disabled: Boolean, maxlength: { type: Number, default: 140 } }, emits: ['input'], setup(props, { emit }) {
  return () => h('input', { value: props.value, disabled: props.disabled, maxlength: props.maxlength,
    onInput: (event: Event) => { if (!props.disabled) emit('input', { detail: { value: (event.target as HTMLInputElement).value } }); },
  });
} });
export function mountPage(component: Component, { client, storage = createMemoryStorage(), controllers }: { client: AppClient; storage?: SessionStorage; controllers?: ReturnType<typeof provideAppClient> }) {
  let context!: ReturnType<typeof provideAppClient>; let request = 0; const navigation: string[] = [];
  const wrapper = mount(component, { global: { plugins: [{ install(app) {
    if (controllers) { context = controllers; app.provide(appClientKey, controllers); }
    else context = provideAppClient(app, client, { storage, newRequestId: async () => `fixture-request-${++request}` });
  } }], stubs: { UniView: View, UniText: Text, UniButton: Button, UniInput: Input } } });
  const hooks = (wrapper.vm.$ as typeof wrapper.vm.$ & { uniTestHooks?: Record<string, (() => unknown)[]> }).uniTestHooks ?? {};
  async function drive(name: string) { for (const fn of hooks[name] ?? []) await fn(); await flushPromises(); }
  const unmount = wrapper.unmount.bind(wrapper); wrapper.unmount = () => { if (!controllers) context.family.dispose(); unmount(); };
  return { wrapper, controllers: context, auth: context.auth, family: context.family, navigation, show: () => drive('show'), hide: () => drive('hide'), unload: () => drive('unload') };
}
