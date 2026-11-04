import { defineComponent, getCurrentInstance, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { Component } from 'vue';
import type { AppClient } from 'home-contracts';
import { appClientKey } from '../../src/shared/app-client';
import { createAuthController } from '../../src/features/auth/use-auth';

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
export function mountPage(component: Component, { client }: { client: AppClient }) {
  const auth = createAuthController(client.account); const navigation: string[] = [];
  const wrapper = mount(component, { global: { provide: { [appClientKey as symbol]: { client, auth } }, stubs: { UniView: View, UniText: Text, UniButton: Button } } });
  const hooks = (wrapper.vm.$ as typeof wrapper.vm.$ & { uniTestHooks?: Record<string, (() => unknown)[]> }).uniTestHooks ?? {};
  async function drive(name: string) { for (const fn of hooks[name] ?? []) await fn(); await flushPromises(); }
  return { wrapper, auth, navigation, show: () => drive('show'), hide: () => drive('hide'), unload: () => drive('unload') };
}
