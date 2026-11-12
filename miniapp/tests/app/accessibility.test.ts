// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import HomeAction from '../../src/components/HomeAction.vue';
import List from '../../src/pages/recipes/index.vue';
import Edit from '../../src/pages/recipes/edit.vue';
import Home from '../../src/pages/family/home.vue';
import Members from '../../src/pages/family/members.vue';
import Submit from '../../src/pages/imports/submit.vue';
import { mountPage } from '../support/uni-stubs';
import { mediaFixture } from '../support/media-fixtures';
import { readFileSync } from 'node:fs';

beforeEach(() => { vi.stubGlobal('uni', { navigateTo: vi.fn(), switchTab: vi.fn() }); });
afterEach(() => { vi.unstubAllGlobals(); });

test('wechat_font_factor_scales_root_and_reflows_on_each_show', async () => {
  let factor = 1;
  Object.assign(uni, { getAppBaseInfo: () => ({ fontSizeSetting: 17 * factor, fontSizeScaleFactor: factor }), getDeviceInfo: () => ({ platform: 'ios' }) });
  const f = await mediaFixture(); const page = mountPage(List, { client: f.owner });
  try {
    await page.show(); expect(page.wrapper.find('page-meta').attributes('root-font-size')).toBe('16px');
    expect(page.wrapper.find('.recipe-grid').classes()).not.toContain('single-column');
    await page.hide(); factor = 1.4; await page.show();
    expect(page.wrapper.find('page-meta').attributes('root-font-size')).toBe('22.4px');
    expect(page.wrapper.find('.recipe-grid').classes()).toContain('single-column');
  } finally { page.wrapper.unmount(); }
});

test.each([{ platform: 'ios', font: 17, root: '16px' }, { platform: 'ios', font: 25.5, root: '24px' }, { platform: 'android', font: 26, root: '26px' }])('older_font_setting_is_normalized_%j', async ({ platform, font, root }) => {
  Object.assign(uni, { getAppBaseInfo: () => ({ fontSizeSetting: font }), getDeviceInfo: () => ({ platform }) });
  const f = await mediaFixture(); const page = mountPage(Submit, { client: f.owner });
  try {
    await page.show(); expect(page.wrapper.find('page-meta').attributes('root-font-size')).toBe(root);
    expect(page.wrapper.find('textarea').classes()).toContain('home-textarea');
  }
  finally { page.wrapper.unmount(); }
});

test('actual_search_node_is_named_and_clear_resets_results', async () => {
  const f = await mediaFixture(); await f.recipe(); const page = mountPage(List, { client: f.owner }); await page.show();
  try {
    const input = page.wrapper.find('[data-query] input'); expect(input.attributes('aria-label')).toBe('搜索菜谱');
    await input.setValue('不存在'); await input.trigger('confirm'); await flushPromises();
    expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(0);
    expect(page.wrapper.find('[aria-role="status"][aria-live="polite"]').exists()).toBe(true);
    await page.wrapper.find('[data-clear-query]').trigger('click'); await flushPromises();
    expect((input.element as HTMLInputElement).value).toBe(''); expect(page.wrapper.findAll('[data-recipe]')).toHaveLength(1);
  } finally { page.wrapper.unmount(); }
});

test('editor_native_fields_have_distinct_row_names_and_keep_binding', async () => {
  const f = await mediaFixture(); const page = mountPage(Edit, { client: f.owner }); await page.show();
  try {
    const title = page.wrapper.find('input[data-title]'); expect(title.attributes('aria-label')).toBe('菜谱标题');
    await title.setValue('本地草稿'); await page.wrapper.find('[data-add-ingredient]').trigger('click');
    const names = page.wrapper.findAll('input[data-name]').map(node => node.attributes('aria-label'));
    expect(names).toEqual(['食材 1 名称', '食材 2 名称']);
    expect(page.wrapper.find('input[data-quantity]').attributes('aria-label')).toContain('留空表示未注明');
    expect((title.element as HTMLInputElement).value).toBe('本地草稿');
  } finally { page.wrapper.unmount(); }
});

test('family_navigation_uses_cells_and_removal_is_danger', async () => {
  const f = await mediaFixture(); const home = mountPage(Home, { client: f.owner }); await home.show();
  try { expect(home.wrapper.find('[data-members] .wd-cell').exists()).toBe(true); }
  finally { home.wrapper.unmount(); }
  const members = mountPage(Members, { client: f.owner }); await members.show();
  try { expect(members.wrapper.find('[data-remove-member] .is-danger').exists()).toBe(true); }
  finally { members.wrapper.unmount(); }
});

test('action_has_one_semantic_target_and_guards_keyboard_and_pointer_while_busy', async () => {
  const wrapper = mount(HomeAction, { props: { label: '收藏菜谱', pressed: false }, global: { stubs: {
    UniView: { template: '<div><slot /></div>' }, UniButton: { template: '<button><slot /></button>' },
  } } });
  try {
    const target = wrapper.find('.home-action');
    expect(target.attributes('aria-label')).toBe('收藏菜谱');
    expect(wrapper.find('[aria-hidden="true"][inert]').exists()).toBe(true);
    await wrapper.find('button').trigger('click'); expect(wrapper.emitted('click')).toHaveLength(1);
    await target.trigger('keydown', { key: 'Enter' }); expect(wrapper.emitted('click')).toHaveLength(2);
    await wrapper.setProps({ disabled: true, pressed: true });
    expect(target.attributes('aria-disabled')).toBe('true'); expect(target.attributes('aria-pressed')).toBe('true');
    await target.trigger('click'); await target.trigger('keydown', { key: ' ' });
    expect(wrapper.emitted('click')).toHaveLength(2);
    await wrapper.setProps({ disabled: false, loading: true });
    expect(target.attributes('aria-busy')).toBe('true'); await target.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(2);
    await wrapper.setProps({ pressed: undefined }); expect(target.attributes('aria-pressed')).toBeUndefined();
  } finally { wrapper.unmount(); }
});

test('theme_foreground_and_boundary_pairs_meet_contrast_on_their_surfaces', () => {
  const css = readFileSync('src/styles/theme.css', 'utf8');
  const token = (name: string) => css.match(new RegExp('--home-' + name + ':\\s*(#[0-9a-f]+)'))![1];
  const luminance = (hex: string) => {
    const color = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
    const channels = color.match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const background of ['surface', 'bg', 'selected']) {
    for (const foreground of ['text', 'primary', 'danger', 'warning']) expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('border'), token(background))).toBeGreaterThanOrEqual(3);
  }
  for (const background of ['surface', 'bg']) expect(contrast(token('muted'), token(background))).toBeGreaterThanOrEqual(4.5);
});
