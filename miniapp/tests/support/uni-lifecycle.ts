import { registerHook } from './uni-stubs';
export const onShow = (fn: () => unknown) => registerHook('show', fn);
export const onHide = (fn: () => unknown) => registerHook('hide', fn);
export const onUnload = (fn: () => unknown) => registerHook('unload', fn);
export const onLaunch = (fn: () => unknown) => registerHook('launch', fn);
export const onLoad = (fn: (query: Record<string, string | undefined>) => unknown) => registerHook('load', fn);
export const onShareAppMessage = (fn: () => unknown) => registerHook('share', fn);
