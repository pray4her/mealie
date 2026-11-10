import { defineComponent, getCurrentInstance, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import type { Component, PropType } from 'vue';
import type { Action } from '@wot-ui/ui/components/wd-action-sheet/types';
import type { AppClient } from 'home-contracts';
import { appClientKey, provideAppClient } from '../../src/shared/app-client';
import { createMemoryStorage } from './sdk-transport';
import type { SessionStorage } from '../../src/shared/session-boundary';

export function registerHook(name: string, callback: (value: never) => unknown) {
  const instance = getCurrentInstance(); if (!instance) throw new Error('Hook registered outside setup');
  const context = instance as typeof instance & { uniTestHooks?: Record<string, ((value: never) => unknown)[]> };
  const hooks = context.uniTestHooks ??= {}; (hooks[name] ??= []).push(callback);
}
export function nativeNavigation(initial: string[] = ['/pages/account/login']) {
  const stack = [...initial]; const events: { kind: string; url: string }[] = [];
  const tabs = ['/pages/recipes/index', '/pages/family/home'];
  function move(kind: string, url: string) {
    events.push({ kind, url });
    if (kind === 'switchTab' ? !tabs.includes(url) : tabs.includes(url)) return;
    if (kind === 'navigateTo') stack.push(url);
    else if (kind === 'redirectTo') stack.splice(-1, 1, url);
    else stack.splice(0, stack.length, url);
  }
  return { stack, events, getCurrentPages: () => stack.map(url => ({ route: url.slice(1).split('?')[0] })),
    uni: {
      navigateTo: ({ url }: { url: string }) => move('navigateTo', url),
      redirectTo: ({ url }: { url: string }) => move('redirectTo', url),
      reLaunch: ({ url }: { url: string }) => move('reLaunch', url),
      switchTab: ({ url }: { url: string }) => move('switchTab', url),
      navigateBack: ({ fail }: { fail?: () => void } = {}) => { if (stack.length < 2) { fail?.(); return; } stack.pop(); events.push({ kind: 'navigateBack', url: stack.at(-1)! }); },
    },
  };
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
const Textarea = defineComponent({ props: { value: { type: String, default: '' }, disabled: Boolean, maxlength: { type: Number, default: 140 } }, emits: ['input'], setup(props, { emit }) {
  return () => h('textarea', { value: props.value, disabled: props.disabled, maxlength: props.maxlength,
    onInput: (event: Event) => { if (!props.disabled) emit('input', { detail: { value: (event.target as HTMLTextAreaElement).value } }); },
  });
} });
const WotButton = defineComponent({ name: 'WdButton', props: { disabled: Boolean, loading: Boolean }, emits: ['click'], setup(props, { slots, emit }) {
  return () => h('button', { disabled: props.disabled || props.loading, 'aria-busy': props.loading,
    onClick: (event: Event) => { if (!props.disabled && !props.loading) emit('click', event); },
  }, slots.default?.());
} });
function wotTextControl(tag: 'input' | 'textarea') {
  return defineComponent({ name: tag === 'input' ? 'WdInput' : 'WdTextarea', props: { modelValue: { type: [String, Number], default: '' }, disabled: Boolean, readonly: Boolean, maxlength: { type: Number, default: -1 } },
    emits: ['update:modelValue', 'input', 'confirm'], setup(props, { emit }) {
      return () => h(tag, { value: props.modelValue, disabled: props.disabled, readonly: props.readonly, maxlength: props.maxlength,
        onInput: (event: Event) => { if (!props.disabled && !props.readonly) { const value = (event.target as HTMLInputElement).value; emit('update:modelValue', value); emit('input', { value }); } },
        onConfirm: () => { if (!props.disabled && !props.readonly) emit('confirm', { value: props.modelValue }); },
      });
    },
  });
}
const WotActionSheet = defineComponent({ name: 'WdActionSheet', props: {
  modelValue: Boolean, actions: { type: Array as PropType<Action[]>, default: () => [] }, cancelText: { type: String, default: '' }, title: { type: String, default: '' }, closeOnClickAction: { type: Boolean, default: true },
}, emits: ['update:modelValue', 'select', 'cancel'], setup(props, { slots, emit }) {
  return () => props.modelValue ? h('div', { role: 'dialog', 'aria-label': props.title }, [
    ...(slots.default?.() ?? props.actions.map((item, index) => h('button', { 'data-action': index, disabled: item.disabled || item.loading,
      onClick: () => { if (item.disabled || item.loading) return; emit('select', { item, index }); if (props.closeOnClickAction) emit('update:modelValue', false); },
    }, item.name))),
    ...(props.cancelText ? [h('button', { 'data-cancel': '', onClick: () => { emit('cancel'); emit('update:modelValue', false); } }, props.cancelText)] : []),
  ]) : null;
} });
export function mountPage(component: Component, { client, storage = createMemoryStorage(), controllers }: { client: AppClient; storage?: SessionStorage; controllers?: ReturnType<typeof provideAppClient> }) {
  let context!: ReturnType<typeof provideAppClient>; let request = 0; const navigation: string[] = [];
  const wrapper = mount(component, { global: { plugins: [{ install(app) {
    if (controllers) { context = controllers; app.provide(appClientKey, controllers); }
    else context = provideAppClient(app, client, { storage, newRequestId: async () => `fixture-request-${++request}` });
  } }], stubs: { UniView: View, UniText: Text, UniButton: Button, UniInput: Input, UniTextarea: Textarea,
    WdButton: WotButton, WdInput: wotTextControl('input'), WdTextarea: wotTextControl('textarea'), WdActionSheet: WotActionSheet,
  } } });
  const hooks = (wrapper.vm.$ as typeof wrapper.vm.$ & { uniTestHooks?: Record<string, ((value: never) => unknown)[]> }).uniTestHooks ?? {};
  async function drive(name: string, value?: unknown) { let result: unknown; for (const fn of hooks[name] ?? []) result = await fn(value as never); await flushPromises(); return result; }
  const unmount = wrapper.unmount.bind(wrapper); wrapper.unmount = () => { if (!controllers) { context.imports.dispose(); context.recipes.dispose(); context.media.dispose(); context.membership.dispose(); context.family.dispose(); context.invitations.dispose(); } unmount(); };
  return { wrapper, controllers: context, auth: context.auth, family: context.family, navigation, show: () => drive('show'), hide: () => drive('hide'), unload: () => drive('unload'), load: (query: Record<string, string>) => drive('load', query), share: () => drive('share') as Promise<{ title: string; path: string; imageUrl: string }> };
}
