// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createHarness } from '../support/harness';
import { mountPage } from '../support/uni-stubs';
import { deferCall } from '../support/sdk-transport';
import { mediaFixture, png } from '../support/media-fixtures';
import Edit from '../../src/pages/recipes/edit.vue';
import Submit from '../../src/pages/imports/submit.vue';
import Onboarding from '../../src/pages/family/onboarding.vue';
import Join from '../../src/pages/family/join.vue';
import { AppError } from '../../src/shared/errors';
import { copy } from '../../src/shared/copy';
import { parseInput, parseRecipe, RecipeInputError } from '../../src/features/recipes/validation';

const navigation: string[] = []; let accept = false;
const enable = vi.fn(); const disable = vi.fn(); const scroll = vi.fn();
const modal = vi.fn(async (options: { confirmText?: string }) => {
  if ([...(options.confirmText ?? '确定')].length > 4) throw new Error('showModal:fail confirmText exceeds 4 characters');
  return { confirm: accept, cancel: !accept };
});
beforeEach(() => {
  accept = false; navigation.length = 0; enable.mockClear(); disable.mockClear(); scroll.mockClear(); modal.mockClear();
  vi.stubGlobal('uni', { enableAlertBeforeUnload: enable, disableAlertBeforeUnload: disable, pageScrollTo: scroll, showModal: modal,
    switchTab: ({ url }: { url: string }) => navigation.push(url), navigateTo: ({ url }: { url: string }) => navigation.push(url),
    reLaunch: ({ url }: { url: string }) => navigation.push(url), redirectTo: ({ url }: { url: string }) => navigation.push(url) });
});
afterEach(() => vi.unstubAllGlobals());
const input = () => ({ title: '汤', description: null, baseServings: null, prepMinutes: 0, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] });
async function fixture(hasFamily = true) {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  if (hasFamily) await client.family.create({ requestId: 'form-test-family-01', name: '家' });
  return { h, client };
}
async function fill(page: ReturnType<typeof mountPage>) {
  await page.wrapper.find('input[data-title]').setValue('家常汤');
  await page.wrapper.find('input[data-raw]').setValue('盐适量'); await page.wrapper.find('input[data-name]').setValue('盐');
  await page.wrapper.find('textarea[data-step]').setValue('煮熟。');
}

test('shared_recipe_rules_return_all_field_paths_and_keep_read_boundary_unavailable', () => {
  expect(parseInput(input())).toMatchObject({ baseServings: null, prepMinutes: 0, ingredients: [{ quantity: null }] });
  try {
    parseInput({ ...input(), title: '🍲'.repeat(121), baseServings: 0, prepMinutes: 10081, cookMinutes: -1,
      ingredients: [{ ...input().ingredients[0], quantity: 0 }], steps: ['字'.repeat(2001)], tags: ['字'.repeat(41)] });
    expect.fail('invalid recipe accepted');
  } catch (error) {
    expect(error).toBeInstanceOf(RecipeInputError);
    expect(error).toMatchObject({ code: 'INVALID_INPUT', issues: [
      { path: ['title'] }, { path: ['baseServings'] }, { path: ['prepMinutes'] }, { path: ['cookMinutes'] },
      { path: ['ingredients', 0, 'quantity'] }, { path: ['steps', 0] }, { path: ['tags', 0] },
    ] });
  }
  expect(() => parseRecipe(input())).toThrowError(new AppError('UNAVAILABLE'));
});

test('recipe_utf8_limit_accepts_32768_bytes_and_rejects_the_next_byte', () => {
  const recipe = { ...input(), description: '🍲'.repeat(10), steps: Array.from({ length: 17 }, () => 'x') };
  let remaining = 32768 - Buffer.byteLength(JSON.stringify(recipe), 'utf8');
  for (let index = 0; remaining > 0; index++) {
    const added = Math.min(1999, remaining); recipe.steps[index] += 'x'.repeat(added); remaining -= added;
  }
  expect(Buffer.byteLength(JSON.stringify(recipe), 'utf8')).toBe(32768); expect(parseInput(recipe)).toEqual(recipe);
  recipe.steps[16] += 'x';
  expect(() => parseInput(recipe)).toThrowError(RecipeInputError);
  try { parseInput(recipe); } catch (error) { expect(error).toMatchObject({ issues: [{ path: ['_form'], message: expect.stringContaining('32 KiB') }] }); }
});

test('recipe_errors_reveal_first_field_and_remain_on_the_same_row_after_remove_and_add', async () => {
  const f = await fixture(); const send = vi.spyOn(f.client.recipes, 'create'); const page = mountPage(Edit, f); await page.show(); await fill(page);
  try {
    await page.wrapper.find('[data-add-ingredient]').trigger('click');
    const second = page.wrapper.findAll('[data-ingredient]')[1];
    await second.find('[data-raw]').setValue('水'); await second.find('[data-name]').setValue('水'); await second.find('[data-quantity]').setValue('0');
    const key = second.find('[data-quantity]').attributes('id');
    await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
    expect(send).not.toHaveBeenCalled(); expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ selector: '#' + key }));
    expect(second.find('[data-quantity]').attributes('aria-invalid')).toBe('true');
    expect(second.find('[data-quantity]').attributes('aria-describedby')).toBe(key + '-error');
    expect(page.wrapper.find('#' + key + '-error').text()).toContain('大于 0');
    accept = true; await page.wrapper.findAll('[data-remove-ingredient]')[0].trigger('click'); await flushPromises(); await page.wrapper.find('[data-add-ingredient]').trigger('click');
    expect(page.wrapper.findAll('[data-ingredient]')[0].find('[data-quantity]').attributes('id')).toBe(key);
    expect(page.wrapper.findAll('[data-ingredient]')[0].find('[data-quantity]').attributes('aria-invalid')).toBe('true');
    expect(page.wrapper.findAll('[data-ingredient]')[1].find('[data-quantity]').attributes('aria-invalid')).toBe('false');
    await page.wrapper.findAll('[data-ingredient]')[0].find('[data-quantity]').setValue('2');
    expect(page.wrapper.find('#' + key + '-error').exists()).toBe(false);
  } finally { page.wrapper.unmount(); }
});

test('recipe_draft_survives_background_and_cancelled_leave_then_success_clears_native_alert', async () => {
  const f = await fixture(); const page = mountPage(Edit, f); await page.show(); await fill(page);
  try {
    expect(enable).toHaveBeenCalled(); await page.hide(); await page.show();
    expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('家常汤');
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises(); expect(modal).toHaveBeenCalled(); expect(navigation).toEqual([]);
    await page.wrapper.find('[data-save]').trigger('click'); await flushPromises();
    expect(navigation.at(-1)).toMatch(/^\/pages\/recipes\/detail\?id=/); expect(disable).toHaveBeenCalled();
  } finally { page.wrapper.unmount(); }
});

test('leave_confirmation_cannot_navigate_after_the_family_scope_changed', async () => {
  const f = await fixture(); const page = mountPage(Edit, f); await page.show(); await fill(page);
  const gate = deferCall(); modal.mockImplementationOnce(async () => { await gate.promise; return { confirm: true, cancel: false }; });
  try {
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises();
    await f.h.database.transaction(async tx => { const member = await tx.get<Record<string, unknown>>('family_members', 'alice'); await tx.replace('family_members', 'alice', { ...member, _id: 'alice', generation: 'new-generation' }); });
    await page.family.load(); await flushPromises(); const before = [...navigation]; gate.resolve(null); await flushPromises();
    expect(navigation).toEqual(before);
  } finally { page.wrapper.unmount(); }
});

test('failed_confirmed_reload_rearms_alert_and_keeps_unsaved_text', async () => {
  const f = await fixture(); const home = (await f.client.family.current())!;
  const recipe = await f.client.recipes.create({ requestId: 'form-test-recipe-01', familyId: home.familyId, generation: home.generation, recipe: input() });
  const page = mountPage(Edit, f); await page.load({ id: recipe.id }); await page.show();
  try {
    await page.wrapper.find('[data-title]').setValue('本地修改'); accept = true; enable.mockClear();
    vi.spyOn(f.client.recipes, 'get').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
    await page.wrapper.find('[data-reload]').trigger('click'); await flushPromises();
    expect(enable).toHaveBeenCalled(); expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('本地修改');
  } finally { page.wrapper.unmount(); }
});

test('image_save_keeps_the_text_leave_guard_dirty', async () => {
  Object.assign(uni, { chooseImage: async () => ({ tempFilePaths: ['temp/image.png'], tempFiles: [{ path: 'temp/image.png', size: png.length }] }),
    getFileSystemManager: () => ({ readFile: (options: { success(value: { data: string }): void }) => options.success({ data: png.toString('base64') }) }) });
  const f = await mediaFixture(); const recipe = await f.recipe(); const page = mountPage(Edit, { client: f.owner }); await page.load({ id: recipe.id }); await page.show();
  try {
    await page.wrapper.find('[data-title]').setValue('未保存文字'); await page.wrapper.find('[data-choose-image]').trigger('click'); await flushPromises();
    await page.wrapper.find('[data-save-images]').trigger('click'); await flushPromises();
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises();
    expect(modal).toHaveBeenCalled(); expect(navigation).toEqual([]);
    expect(await f.owner.recipes.get(recipe.id)).toMatchObject({ title: '图片菜谱', version: 2 });
    expect((page.wrapper.find('[data-title]').element as HTMLInputElement).value).toBe('未保存文字');
  } finally { page.wrapper.unmount(); }
});

test('import_validates_utf8_inline_and_retains_input_on_background_and_cancelled_leave', async () => {
  const f = await fixture(); const send = vi.spyOn(f.client.imports, 'submit'); const page = mountPage(Submit, f); await page.show();
  try {
    await page.wrapper.find('[data-text]').setValue('字'.repeat(5462)); await page.wrapper.find('[data-submit]').trigger('click'); await flushPromises();
    expect(send).not.toHaveBeenCalled(); expect(page.wrapper.find('[data-text]').attributes('aria-describedby')).toBe('text-error');
    expect(page.wrapper.find('#text-error').text()).toContain('16 KiB'); expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ selector: '#text' }));
    await page.wrapper.find('[data-text]').setValue('一道菜原文'); await page.hide(); await page.show();
    expect((page.wrapper.find('[data-text]').element as HTMLTextAreaElement).value).toBe('一道菜原文');
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises(); expect(navigation).toEqual([]);
    expect(page.wrapper.find('#text-error').exists()).toBe(false);
    await page.unload(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  } finally { page.wrapper.unmount(); }
});

test('family_name_and_manual_code_validate_inline_preserve_background_and_confirm_navigation', async () => {
  const f = await fixture(false); const page = mountPage(Onboarding, f); await page.show();
  try {
    await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
    expect(page.wrapper.find('input').attributes('aria-describedby')).toBe('family-name-error');
    expect(page.wrapper.find('#family-name-error').text()).toContain('1至40');
    await page.wrapper.find('input').setValue('尚未提交'); await page.hide(); await page.show();
    expect((page.wrapper.find('input').element as HTMLInputElement).value).toBe('尚未提交');
    await page.wrapper.find('[data-open-join]').trigger('click'); await flushPromises(); expect(navigation).toEqual([]);
    accept = true; await page.wrapper.find('[data-open-join]').trigger('click'); await flushPromises(); expect(navigation.at(-1)).toBe('/pages/family/join');
  } finally { page.wrapper.unmount(); }
  navigation.length = 0; accept = false;
  const join = mountPage(Join, f); await join.show();
  try {
    await join.wrapper.find('input').setValue('错误邀请码'); await join.wrapper.find('[data-confirm-join]').trigger('click'); await flushPromises();
    expect(join.wrapper.find('input').attributes('aria-describedby')).toBe('invitation-code-error');
    await join.hide(); await join.show(); expect((join.wrapper.find('input').element as HTMLInputElement).value).toBe('错误邀请码');
    await join.wrapper.find('[data-back-onboarding]').trigger('click'); await flushPromises(); expect(navigation).toEqual([]);
    accept = true; await join.wrapper.find('[data-back-onboarding]').trigger('click'); await flushPromises(); expect(navigation.at(-1)).toBe('/pages/family/onboarding');
  } finally { join.wrapper.unmount(); }
});

test.each(['local', 'server'])('family_name_%s_error_has_one_named_node_and_clears_after_input_changes', async source => {
  const f = await fixture(false); const create = vi.spyOn(f.client.family, 'create');
  if (source === 'server') create.mockRejectedValueOnce(new AppError('INVALID_INPUT'));
  const page = mountPage(Onboarding, f); await page.show();
  try {
    await page.wrapper.find('input').setValue(source === 'local' ? '   ' : '家');
    await page.wrapper.find('[data-create]').trigger('click'); await flushPromises();
    const error = source === 'local' ? copy.invalidFamilyName : copy.familyErrors.INVALID_INPUT;
    expect(page.wrapper.find('input').attributes('aria-describedby')).toBe('family-name-error');
    expect(page.wrapper.findAll('#family-name-error')).toHaveLength(1);
    expect(page.wrapper.findAll('[role="alert"]').map(node => node.text())).toEqual([error]);
    expect(create).toHaveBeenCalledTimes(source === 'local' ? 0 : 1);
    await page.wrapper.find('input').setValue('修改后的家');
    expect(page.wrapper.find('#family-name-error').exists()).toBe(false);
    expect(page.wrapper.find('input').attributes('aria-describedby')).toBeUndefined();
    expect(page.wrapper.text()).not.toContain(error); expect(page.wrapper.findAll('[role="alert"]')).toHaveLength(0);
  } finally { page.wrapper.unmount(); }
});

test('unavailable_native_alert_does_not_break_explicit_leave_confirmation', async () => {
  enable.mockImplementationOnce(() => { throw new Error('unsupported'); });
  const f = await fixture(); const page = mountPage(Submit, f); await page.show();
  try {
    await page.wrapper.find('[data-text]').setValue('未提交');
    await page.wrapper.find('[data-back]').trigger('click'); await flushPromises(); expect(navigation).toEqual([]);
    accept = true; await page.wrapper.find('[data-back]').trigger('click'); await flushPromises(); expect(navigation.at(-1)).toBe('/pages/recipes/index');
  } finally { page.wrapper.unmount(); }
});
