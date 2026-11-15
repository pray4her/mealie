// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Component } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { PlanEntry, RecipeInput } from 'home-contracts';
import { createHarness } from '../support/harness';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { mountPage } from '../support/uni-stubs';
import Detail from '../../src/pages/recipes/detail.vue';
import { AppError } from '../../src/shared/errors';
import { beijingToday, weekDates } from '../../src/features/planning/dates';
import { enterPage } from '../../src/shared/navigation';
import routes from '../../src/pages.json';

const pages = import.meta.glob<{ default: Component }>('../../src/pages/planning/*.vue');
const cleanups: (() => void)[] = []; const navigation: string[] = []; let accept = false;
const scroll = vi.fn(); const modal = vi.fn(async (options: { confirmText?: string }) => {
  expect([...(options.confirmText ?? '')].length).toBeLessThanOrEqual(4);
  return { confirm: accept, cancel: !accept };
});
beforeEach(() => {
  accept = false; navigation.length = 0; scroll.mockClear(); modal.mockClear();
  const navigate = ({ url }: { url: string }) => navigation.push(url);
  vi.stubGlobal('uni', { showModal: modal, pageScrollTo: scroll, enableAlertBeforeUnload: vi.fn(), disableAlertBeforeUnload: vi.fn(),
    switchTab: navigate, navigateTo: navigate, reLaunch: navigate, redirectTo: navigate });
});
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const fields = { date: '2026-12-31', meal: 'dinner' as const, targetServings: null };
const recipeInput: RecipeInput = { title: '家常汤', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] };
async function fixture(baseServings: number | null = null, withRecipe = true) {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const home = await client.family.create({ requestId: 'planning-ui-family', name: '家' });
  const scope = { familyId: home.familyId, generation: home.generation }; const storage = createMemoryStorage(); let sequence = 0;
  const makeRecipe = () => client.recipes.create({ ...scope, requestId: 'planning-ui-recipe-' + ++sequence, recipe: { ...recipeInput, baseServings } });
  const recipe = withRecipe ? await makeRecipe() : null;
  const add = (extra: Partial<typeof fields> = {}) => client.planning.add({ ...scope, ...fields, ...extra, recipeId: recipe!.id, requestId: 'planning-ui-add-' + ++sequence });
  return { h, client, scope, storage, recipe, makeRecipe, add };
}
async function render(name: 'index' | 'edit', f: Awaited<ReturnType<typeof fixture>>, query: Record<string, string> = {}, controllers?: ReturnType<typeof mountPage>['controllers']) {
  const loader = pages['../../src/pages/planning/' + name + '.vue']; expect(loader, 'implemented planning page').toBeTypeOf('function');
  const page = mountPage((await loader()).default, { ...f, controllers }); cleanups.push(() => page.wrapper.unmount());
  await page.load(query); await page.show(); return page;
}
async function click(page: ReturnType<typeof mountPage>, selector: string) { await page.wrapper.get(selector).trigger('click'); await flushPromises(); }
async function pick(page: ReturnType<typeof mountPage>, value: string) { await page.wrapper.get('[data-date-picker]').trigger('change', { detail: { value } }); await flushPromises(); }
const value = (page: ReturnType<typeof mountPage>) => (page.wrapper.get('input[data-servings]').element as HTMLInputElement).value;

test('three native tabs preserve all eleven routes and append only the two planning pages', () => {
  expect(routes.pages.map(page => page.path)).toEqual(['pages/account/login', 'pages/family/onboarding', 'pages/family/home', 'pages/family/invite', 'pages/family/join', 'pages/family/members', 'pages/recipes/index', 'pages/recipes/detail', 'pages/recipes/edit', 'pages/imports/submit', 'pages/imports/status', 'pages/planning/index', 'pages/planning/edit']);
  expect(routes.tabBar.list.map(tab => [tab.pagePath, tab.text])).toEqual([['pages/recipes/index', '菜谱'], ['pages/planning/index', '计划'], ['pages/family/home', '家庭']]);
  const switchTab = vi.spyOn(uni, 'switchTab'); const relaunch = vi.spyOn(uni, 'reLaunch');
  for (const tab of routes.tabBar.list) enterPage('/' + tab.pagePath);
  expect(switchTab.mock.calls.map(([arg]) => arg.url)).toEqual(['/pages/recipes/index', '/pages/planning/index', '/pages/family/home']);
  enterPage('/pages/planning/edit'); expect(relaunch).toHaveBeenLastCalledWith({ url: '/pages/planning/edit' });
});
test('index uses Monday-first selected week, today and direct dates without querying a fake whole week', async () => {
  const f = await fixture(); const list = vi.spyOn(f.client.planning, 'list'); const page = await render('index', f);
  const today = beijingToday(Date.now()); expect(page.wrapper.findAll('[data-day]').map(node => node.attributes('data-day'))).toEqual(weekDates(today));
  expect(page.wrapper.get('[data-day="' + today + '"]').attributes('aria-label')).toContain('今天');
  expect(page.wrapper.get('[data-day="' + today + '"]').attributes('aria-label')).toContain('已选中');
  await pick(page, fields.date); await click(page, '[data-next-week]'); expect(page.controllers.planning.selectedDate.value).toBe('2027-01-07');
  await click(page, '[data-prev-week]'); expect(page.controllers.planning.selectedDate.value).toBe(fields.date);
  expect(list.mock.calls.every(([input]) => input.from === input.to && input.limit === 20)).toBe(true);
  expect(page.wrapper.findAll('[data-meal-panel]').map(node => node.attributes('data-meal-panel'))).toEqual(['breakfast', 'lunch', 'dinner', 'other']);
  await click(page, '[data-add="lunch"]'); expect(navigation.at(-1)).toBe('/pages/planning/edit?date=2026-12-31&meal=lunch');
  await click(page, '[data-today]'); expect(page.controllers.planning.selectedDate.value).toBe(today);
});
test('first Today activation after Beijing midnight selects and requests the new day without midnight changing the selected date', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-12-31T15:59:59.000Z'));
  const f = await fixture(); const list = vi.spyOn(f.client.planning, 'list'); const page = await render('index', f);
  expect(page.controllers.planning.selectedDate.value).toBe('2026-12-31'); await pick(page, '2026-12-30');
  const reads = list.mock.calls.length; clock.mockReturnValue(Date.parse('2026-12-31T16:00:01.000Z')); await flushPromises();
  expect(page.controllers.planning.selectedDate.value).toBe('2026-12-30'); expect(page.wrapper.get('[data-date-picker]').attributes('value')).toBe('2026-12-30');
  expect(list).toHaveBeenCalledTimes(reads);
  await click(page, '[data-today]');
  expect.soft(page.controllers.planning.selectedDate.value).toBe('2027-01-01');
  expect.soft(page.wrapper.get('[data-date-picker]').attributes('value')).toBe('2027-01-01');
  expect.soft(list).toHaveBeenLastCalledWith({ from: '2027-01-01', to: '2027-01-01', limit: 20 }); expect(list).toHaveBeenCalledTimes(reads + 1);
});
test.each(['0001-01-01', '9999-12-31'])('date boundary %s disables invalid weeks and picker cancel changes nothing', async date => {
  const page = await render('index', await fixture()); await pick(page, date);
  expect(page.wrapper.get(date.startsWith('0001') ? '[data-prev-week]' : '[data-next-week]').attributes('aria-disabled')).toBe('true');
  await page.wrapper.get('[data-date-picker]').trigger('cancel'); expect(page.controllers.planning.selectedDate.value).toBe(date);
  expect(page.wrapper.get('[data-date-picker]').attributes()).toMatchObject({ mode: 'date', start: '0001-01-01', end: '9999-12-31' });
});
test('choose recipe then save nullable and fractional servings as separate same-meal entries', async () => {
  const f = await fixture(); const page = await render('edit', f, { date: fields.date, meal: fields.meal });
  expect(page.wrapper.find('[data-search-stage]').exists()).toBe(true); await click(page, '[data-choose="' + f.recipe!.id + '"]');
  expect(value(page)).toBe(''); await click(page, '[data-save]'); expect(page.wrapper.text()).toContain('已保存');
  expect(page.wrapper.find('[data-save]').exists()).toBe(false); await click(page, '[data-view-plan]'); expect(navigation.at(-1)).toBe('/pages/planning/index');
  const second = await render('edit', f, { recipeId: f.recipe!.id, date: fields.date }, page.controllers);
  expect(second.wrapper.find('[data-save]').exists()).toBe(true); await second.wrapper.get('input[data-servings]').setValue('2.5'); await click(second, '[data-save]');
  const rows = (await f.client.planning.list({ from: fields.date, to: fields.date })).items;
  expect(rows.map(row => row.targetServings)).toEqual([null, 2.5]); expect(rows.map(row => row.titleSnapshot)).toEqual(['家常汤', '家常汤']);
});
test('detail entry is plan-only and new form visibly defaults to Beijing today/dinner and known base servings', async () => {
  const f = await fixture(3.5); const detail = mountPage(Detail, f); cleanups.push(() => detail.wrapper.unmount()); await detail.load({ id: f.recipe!.id }); await detail.show();
  await click(detail, '[data-plan]'); expect(navigation.at(-1)).toBe('/pages/planning/edit?recipeId=' + f.recipe!.id); expect(detail.wrapper.text()).not.toContain('加购');
  const page = await render('edit', f, { recipeId: f.recipe!.id }); expect(value(page)).toBe('3.5');
  expect(page.wrapper.get('[data-date-picker]').attributes('value')).toBe(beijingToday(Date.now()));
  expect(page.wrapper.get('[data-meal="dinner"]').attributes('aria-pressed')).toBe('true');
  expect(await f.h.rows('meal_plans')).toEqual([]);
});
test('search distinguishes empty family, no match, bounded continuation and failed reads', async () => {
  const empty = await render('edit', await fixture(null, false)); expect(empty.wrapper.text()).toContain('家庭还没有菜谱');
  const f = await fixture(); const page = await render('edit', f); await page.wrapper.get('[data-query]').setValue('没有的菜'); await click(page, '[data-search]');
  expect(page.wrapper.text()).toContain('没有匹配的菜谱');
  const list = vi.spyOn(f.client.recipes, 'list').mockResolvedValueOnce({ items: [], nextCursor: 'next' }).mockResolvedValueOnce({ items: [f.recipe!], nextCursor: null });
  await click(page, '[data-search]'); expect(page.wrapper.text()).not.toContain('没有匹配的菜谱'); await click(page, '[data-search-more]');
  expect(list.mock.calls[1][0]).toMatchObject({ cursor: 'next', query: '没有的菜', limit: 20 }); expect(page.wrapper.find('[data-choose]').exists()).toBe(true);
  list.mockRejectedValueOnce(new AppError('UNAVAILABLE')); await click(page, '[data-search]'); expect(page.wrapper.text()).not.toContain('家庭还没有菜谱'); expect(page.wrapper.find('[data-read-retry]').exists()).toBe(true);
});
test.each<Record<string, string>>([{ id: 'bad' }, { recipeId: 'bad' }, { date: '2026-02-30' }, { meal: 'snack' }, { id: 'a'.repeat(32), recipeId: 'b'.repeat(32) }])('invalid initial query %j cannot fetch or save a different target', async query => {
  const f = await fixture(); const get = vi.spyOn(f.client.planning, 'get'); const page = await render('edit', f, query);
  expect(page.wrapper.text()).toContain('参数'); expect(page.wrapper.find('[data-save]').exists()).toBe(false); expect(get).not.toHaveBeenCalled();
});
test.each(['0', '-1', 'Infinity', '1e2', '10000.1'])('invalid servings %s retain raw text and reveal named field', async text => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id }); await page.wrapper.get('[data-servings]').setValue(text); await click(page, '[data-save]');
  expect(await f.h.rows('meal_plans')).toEqual([]); expect(value(page)).toBe(text); expect(page.wrapper.get('[data-servings]').attributes('aria-describedby')).toBe('targetServings-error');
  expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ selector: '#targetServings' })); expect(page.wrapper.get('#targetServings-error').text()).toContain('10000');
});
test('invalid picker date reveals date error and cancel preserves draft; application leave confirms', async () => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id }); await pick(page, '2026-02-30'); await click(page, '[data-save]');
  expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ selector: '#date' })); expect(page.wrapper.get('#date-error').text()).toContain('日期');
  await pick(page, fields.date); await page.wrapper.get('[data-date-picker]').trigger('cancel'); expect(page.wrapper.get('[data-date-picker]').attributes('value')).toBe(fields.date);
  await click(page, '[data-back]'); expect(navigation).toEqual([]); accept = true; await click(page, '[data-back]'); expect(navigation.at(-1)).toBe('/pages/planning/index');
});
test('existing get locks snapshot and recipe while cross-day update edits only date meal and servings', async () => {
  const f = await fixture(); const row = await f.add(); const page = await render('edit', f, { id: row.id }); const update = vi.spyOn(f.client.planning, 'update');
  expect(page.wrapper.find('[data-change-recipe]').exists()).toBe(false); await pick(page, '2027-01-01'); await click(page, '[data-meal="other"]'); await page.wrapper.get('[data-servings]').setValue('.5'); await click(page, '[data-save]');
  expect(await f.client.planning.get(row.id)).toMatchObject({ date: '2027-01-01', meal: 'other', targetServings: .5, version: 2, recipeId: row.recipeId, titleSnapshot: '家常汤' });
  expect(update.mock.calls[0][0]).not.toHaveProperty('recipeId'); expect(page.controllers.planning.selectedDate.value).toBe('2027-01-01');
});
test('remove confirms known date meal title and unsaved input before removing original version', async () => {
  const f = await fixture(); const row = await f.add(); const page = await render('edit', f, { id: row.id }); await page.wrapper.get('[data-servings]').setValue('4'); await pick(page, '2027-01-01');
  await click(page, '[data-remove]'); expect(await f.client.planning.get(row.id)).toMatchObject({ version: 1 });
  expect(modal.mock.calls[0][0]).toMatchObject({ content: expect.stringMatching(/2026-12-31.*晚餐.*家常汤.*未保存/) });
  accept = true; await click(page, '[data-remove]'); expect(await f.h.rows('meal_plans')).toEqual([]); expect(page.wrapper.text()).toContain('已移除');
  expect(page.controllers.planning.selectedDate.value).toBe('2026-12-31');
});
test('conflict retains draft and base version across actual same-family auth revalidation until confirmed reload', async () => {
  const f = await fixture(); const row = await f.add(); const page = await render('edit', f, { id: row.id }); await page.wrapper.get('[data-servings]').setValue('4');
  await f.client.planning.update({ ...f.scope, ...fields, id: row.id, version: 1, targetServings: 2, requestId: 'planning-other-update' });
  const update = vi.spyOn(f.client.planning, 'update'); await page.hide(); await page.show(); expect(value(page)).toBe('4'); await click(page, '[data-save]');
  expect(update.mock.calls[0][0].version).toBe(1); expect(value(page)).toBe('4'); expect(page.wrapper.text()).toContain('其他成员');
  await click(page, '[data-reload]'); expect(value(page)).toBe('4'); accept = true; await click(page, '[data-reload]'); expect(value(page)).toBe('2');
  await page.wrapper.get('[data-servings]').setValue('5'); await click(page, '[data-save]'); expect(update.mock.calls[1][0].version).toBe(2);
});
test.each(['add', 'update', 'remove'] as const)('cold pending %s restores original intent, locks fields and retries the identical id even after deletion', async kind => {
  const f = await fixture(); const row = kind === 'add' ? null : await f.add();
  const input = { ...f.scope, requestId: 'planning-pending-original', ...(kind === 'add' ? { ...fields, targetServings: 2.5, recipeId: f.recipe!.id } : kind === 'update' ? { ...fields, id: row!.id, version: 1, targetServings: 2.5 } : { id: row!.id, version: 1 }) };
  if (kind === 'remove') await f.client.planning.remove(input as Parameters<typeof f.client.planning.remove>[0]);
  f.storage.set('home.planning.pending.v1:alice', { kind, input }); const page = await render('edit', f);
  expect(page.wrapper.text()).toContain('原请求'); expect(page.wrapper.find('[data-save]').exists()).toBe(false);
  if (kind !== 'remove') { expect(value(page)).toBe('2.5'); expect(page.wrapper.get('[data-servings]').attributes('disabled')).toBeDefined(); await pick(page, '2028-01-01'); expect(page.wrapper.get('[data-date-picker]').attributes('value')).toBe(fields.date); }
  const send = vi.spyOn(f.client.planning, kind); await click(page, '[data-resume]'); expect(send.mock.calls[0][0]).toEqual(input);
  expect(page.wrapper.text()).toContain(kind === 'remove' ? '已移除' : '已保存'); expect(await f.h.rows('meal_plans')).toHaveLength(kind === 'remove' ? 0 : 1);
});
test('source disappeared still shows snapshot and allows editing/removing without a source link', async () => {
  const f = await fixture(); const row = await f.add(); await f.h.database.transaction(tx => tx.remove('recipes', f.recipe!.id));
  const page = await render('edit', f, { id: row.id }); expect(page.wrapper.text()).toContain('家常汤'); expect(page.wrapper.text()).toContain('菜谱已不可用');
  await page.wrapper.get('[data-servings]').setValue('2'); await click(page, '[data-save]'); expect(await f.client.planning.get(row.id)).toMatchObject({ targetServings: 2, titleSnapshot: '家常汤', sourceAvailable: false });
  const index = await render('index', f, {}, page.controllers); await pick(index, fields.date); expect(index.wrapper.find('[data-source]').exists()).toBe(false); expect(index.wrapper.find('[data-edit="' + row.id + '"]').exists()).toBe(true);
});
test('index pagination never labels unloaded meals empty; read errors remain distinct from confirmed writes', async () => {
  const f = await fixture(); const row = { ...await f.add(), date: beijingToday(Date.now()) }; const list = vi.spyOn(f.client.planning, 'list').mockResolvedValueOnce({ items: [], nextCursor: 'next' }).mockResolvedValueOnce({ items: [row], nextCursor: null });
  const page = await render('index', f); expect(page.wrapper.text()).not.toContain('还没有安排'); await click(page, '[data-more]');
  expect(list.mock.calls[1][0].cursor).toBe('next'); expect(page.wrapper.get('[data-plan-entry]').text()).toContain('份数未注明');
  list.mockRejectedValueOnce(new AppError('UNAVAILABLE')); await click(page, '[data-read-retry]'); expect(page.wrapper.text()).not.toContain('还没有安排');
});
test('new recipe may change only after confirming discarded edits', async () => {
  const f = await fixture(2); const page = await render('edit', f, { recipeId: f.recipe!.id }); await page.wrapper.get('[data-servings]').setValue('5');
  await click(page, '[data-change-recipe]'); expect(value(page)).toBe('5'); accept = true; await click(page, '[data-change-recipe]'); expect(page.wrapper.find('[data-search-stage]').exists()).toBe(true);
});
test.each(['logout', 'family', 'generation'])('%s clears local title draft and target instead of carrying them to another scope', async kind => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id }); await page.wrapper.get('[data-servings]').setValue('7');
  if (kind === 'logout') await page.auth.signOut();
  else { const current = (await f.client.family.current())!; vi.spyOn(f.client.family, 'current').mockResolvedValue({ ...current, [kind === 'family' ? 'familyId' : 'generation']: 'replacement' }); await page.family.load(); }
  await flushPromises(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(page.wrapper.text()).not.toContain('家常汤');
  if (kind !== 'logout') { await page.show(); expect(page.wrapper.find('[data-save]').exists()).toBe(false); expect(page.wrapper.find('[data-search-stage]').exists()).toBe(true); }
});
test('hidden acknowledgment refresh failure cannot expose a fresh add, while unrelated prior ack never commits a new form', async () => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id, date: fields.date }); const gate = deferCall();
  vi.spyOn(f.client.planning, 'get').mockImplementationOnce(async () => { await gate.promise; throw new AppError('UNAVAILABLE'); }).mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const add = vi.spyOn(f.client.planning, 'add'); await page.wrapper.get('[data-save]').trigger('click'); await flushPromises();
  expect(page.controllers.planning.confirmed.value?.kind).toBe('add'); await page.hide(); await page.show(); gate.resolve(null); await flushPromises();
  expect(page.wrapper.find('[data-save]').exists()).toBe(false); expect(page.wrapper.text()).toContain('已保存'); expect(page.wrapper.text()).toContain('刷新失败'); expect(add).toHaveBeenCalledTimes(1);
  await click(page, '[data-read-retry]'); expect(await f.h.rows('meal_plans')).toHaveLength(1);
  const fresh = await render('edit', f, { recipeId: f.recipe!.id }, page.controllers); expect(fresh.wrapper.find('[data-save]').exists()).toBe(true);
});
test('hidden cross-day update acknowledgment returns View Plan to the saved date despite failing get without committing an unrelated new form', async () => {
  const f = await fixture(); const row = await f.add(); const index = await render('index', f); await pick(index, fields.date); await index.hide();
  const page = await render('edit', f, { id: row.id }, index.controllers); await pick(page, '2027-01-01');
  const gate = deferCall(); const readStored = f.client.planning.get.bind(f.client.planning);
  const get = vi.spyOn(f.client.planning, 'get').mockImplementationOnce(async () => { await gate.promise; throw new AppError('UNAVAILABLE'); }).mockRejectedValue(new AppError('UNAVAILABLE'));
  const update = vi.spyOn(f.client.planning, 'update'); const list = vi.spyOn(f.client.planning, 'list');
  await page.wrapper.get('[data-save]').trigger('click'); await flushPromises();
  expect(page.controllers.planning.confirmed.value).toMatchObject({ kind: 'update', id: row.id }); expect(get).toHaveBeenCalledTimes(1);
  expect(await readStored(row.id)).toMatchObject({ date: '2027-01-01', version: 2 });
  await page.hide(); await page.show(); expect(get).toHaveBeenCalledTimes(2); gate.resolve(null); await flushPromises();
  expect(page.wrapper.text()).toContain('已保存，刷新失败'); expect(page.wrapper.find('[data-save]').exists()).toBe(false); expect(page.wrapper.find('[data-resume]').exists()).toBe(false);
  await click(page, '[data-read-retry]'); expect(get).toHaveBeenCalledTimes(3); expect(update).toHaveBeenCalledTimes(1);
  await click(page, '[data-view-plan]'); expect(navigation.at(-1)).toBe('/pages/planning/index'); await page.hide(); await index.show();
  expect.soft(index.controllers.planning.selectedDate.value).toBe('2027-01-01');
  expect.soft(index.wrapper.get('[data-date-picker]').attributes('value')).toBe('2027-01-01');
  expect.soft(list).toHaveBeenLastCalledWith({ from: '2027-01-01', to: '2027-01-01', limit: 20 });
  await index.hide(); const selected = index.controllers.planning.selectedDate.value;
  const fresh = await render('edit', f, { recipeId: f.recipe!.id, date: '2027-02-01' }, index.controllers);
  expect(fresh.wrapper.find('[data-save]').exists()).toBe(true); expect(fresh.wrapper.find('[data-view-plan]').exists()).toBe(false);
  expect(fresh.wrapper.get('[data-date-picker]').attributes('value')).toBe('2027-02-01'); expect(fresh.controllers.planning.selectedDate.value).toBe(selected);
  expect(update).toHaveBeenCalledTimes(1);
});
test('visible ack with refresh failure is committed and retry only reads', async () => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id }); vi.spyOn(f.client.planning, 'get').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const add = vi.spyOn(f.client.planning, 'add'); await click(page, '[data-save]'); expect(page.wrapper.text()).toContain('已保存，刷新失败');
  expect(page.wrapper.find('[data-save]').exists()).toBe(false); await click(page, '[data-read-retry]'); expect(add).toHaveBeenCalledTimes(1);
});
test('index private cover errors keep stable fallback, and media auth errors conceal all protected content', async () => {
  const f = await fixture(); const row = await f.add(); const withCover: PlanEntry = { ...row, date: beijingToday(Date.now()), coverImageId: 'c'.repeat(32) };
  vi.spyOn(f.client.planning, 'list').mockResolvedValue({ items: [withCover], nextCursor: null });
  const read = vi.spyOn(f.client.media, 'read').mockResolvedValue({ mediaId: withCover.coverImageId!, url: 'https://private.invalid/cover', expiresAt: Date.now() + 60000 });
  const page = await render('index', f); await page.wrapper.get('image').trigger('error'); await flushPromises();
  expect(page.wrapper.find('image').exists()).toBe(false); expect(page.wrapper.get('[data-cover-fallback]').text()).toContain('暂无图片'); expect(read).toHaveBeenCalledTimes(1);
  read.mockRejectedValueOnce(new AppError('AUTH_REQUIRED')); await click(page, '[data-read-retry]'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation).toContain('/pages/account/login');
});
test('failed existing plan read cannot turn into a recipe chooser or update a different source', async () => {
  const f = await fixture(); const page = await render('edit', f, { id: 'a'.repeat(32) });
  expect(page.wrapper.text()).toContain('不存在或当前不可访问'); expect(page.wrapper.find('[data-search-stage]').exists()).toBe(false); expect(page.wrapper.find('[data-save]').exists()).toBe(false);
});
test('failed initialization still clears old recipe query when family scope changes', async () => {
  const f = await fixture(); vi.spyOn(f.client.recipes, 'get').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const page = await render('edit', f, { recipeId: f.recipe!.id });
  const home = (await f.client.family.current())!; vi.spyOn(f.client.family, 'current').mockResolvedValue({ ...home, generation: 'new-generation' });
  const get = vi.spyOn(f.client.recipes, 'get'); get.mockClear(); await page.family.load(); await page.show();
  expect(get).not.toHaveBeenCalled(); expect(page.wrapper.find('[data-search-stage]').exists()).toBe(true); expect(page.wrapper.find('[data-save]').exists()).toBe(false);
});
test('remove confirmation describes the saved meal rather than unsaved date and meal changes', async () => {
  const f = await fixture(); const row = await f.add(); const page = await render('edit', f, { id: row.id });
  await pick(page, '2027-02-01'); await click(page, '[data-meal="breakfast"]'); await click(page, '[data-remove]');
  expect(modal.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('2026-12-31 · 晚餐 · 家常汤') });
});
test('same-family checking transients conceal the form but keep untouched local date servings and base version', async () => {
  const f = await fixture(); const row = await f.add(); const page = await render('edit', f, { id: row.id });
  await pick(page, '2027-01-01'); await page.wrapper.get('[data-servings]').setValue('3.25'); await page.hide();
  await f.client.planning.update({ ...f.scope, ...fields, id: row.id, version: 1, targetServings: 7, requestId: 'planning-other-edited' });
  const authGate = deferCall(); const familyGate = deferCall(); const session = f.client.account.session.bind(f.client.account); const current = f.client.family.current.bind(f.client.family);
  vi.spyOn(f.client.account, 'session').mockImplementationOnce(async () => { await authGate.promise; return session(); });
  vi.spyOn(f.client.family, 'current').mockImplementationOnce(async () => { await familyGate.promise; return current(); });
  const showing = page.show(); await flushPromises(); expect(page.auth.phase.value).toBe('checking'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  authGate.resolve(null); await flushPromises(); expect(page.family.phase.value).toBe('checking'); expect(page.wrapper.find('[data-protected]').exists()).toBe(false);
  familyGate.resolve(null); await showing; expect(value(page)).toBe('3.25'); expect(page.wrapper.get('[data-date-picker]').attributes('value')).toBe('2027-01-01');
  await click(page, '[data-save]'); expect(page.wrapper.text()).toContain('其他成员'); expect(value(page)).toBe('3.25');
});
test('timeout after actual add hides fresh save and resumes original payload after picker reentry', async () => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id, date: fields.date });
  const add = f.client.planning.add.bind(f.client.planning); const send = vi.spyOn(f.client.planning, 'add').mockImplementationOnce(async input => { await add(input); throw new AppError('UNAVAILABLE'); });
  await page.wrapper.get('[data-servings]').setValue('2.5'); await click(page, '[data-save]'); expect(page.wrapper.find('[data-save]').exists()).toBe(false);
  await page.hide(); await page.show(); expect(value(page)).toBe('2.5'); await click(page, '[data-resume]');
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]); expect(await f.h.rows('meal_plans')).toHaveLength(1);
});
test('recovered add acknowledges a subsequently removed entry without inviting recreation', async () => {
  const f = await fixture(); const page = await render('edit', f, { recipeId: f.recipe!.id, date: fields.date });
  const add = f.client.planning.add.bind(f.client.planning); vi.spyOn(f.client.planning, 'add').mockImplementationOnce(async input => { await add(input); throw new AppError('UNAVAILABLE'); });
  await click(page, '[data-save]'); const row = (await f.client.planning.list({ from: fields.date, to: fields.date })).items[0];
  await f.client.planning.remove({ ...f.scope, id: row.id, version: 1, requestId: 'planning-removed-later' }); await click(page, '[data-resume]');
  expect(page.wrapper.text()).toContain('已保存'); expect(page.wrapper.text()).toContain('不存在或当前不可访问'); expect(page.wrapper.find('[data-save]').exists()).toBe(false); expect(await f.h.rows('meal_plans')).toEqual([]);
});
test.each(['index', 'edit'] as const)('%s reentry revokes protected data and uses login after real token expiry', async name => {
  const f = await fixture(); const page = await render(name, f, name === 'edit' ? { recipeId: f.recipe!.id } : {});
  await page.hide(); f.h.revokeToken('alice'); await page.show(); expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(navigation.at(-1)).toBe('/pages/account/login');
});
test('index keeps loaded rows during continuation and recovers initial read failure', async () => {
  const f = await fixture(); const row = { ...await f.add(), date: beijingToday(Date.now()) };
  const list = vi.spyOn(f.client.planning, 'list').mockRejectedValueOnce(new AppError('UNAVAILABLE')).mockResolvedValueOnce({ items: [row], nextCursor: 'next' });
  const page = await render('index', f); expect(page.wrapper.text()).not.toContain('还没有安排'); await click(page, '[data-read-retry]');
  const gate = deferCall(); list.mockImplementationOnce(async () => { await gate.promise; return { items: [], nextCursor: null }; });
  await page.wrapper.get('[data-more]').trigger('click'); await flushPromises(); expect(page.wrapper.findAll('[data-plan-entry]')).toHaveLength(1); expect(page.wrapper.text()).toContain('正在继续加载');
  gate.resolve(null); await flushPromises(); expect(page.wrapper.findAll('[data-plan-entry]')).toHaveLength(1);
});
test('unload discards unsaved form and late selection cannot repopulate it', async () => {
  const f = await fixture(); const page = await render('edit', f); const gate = deferCall();
  vi.spyOn(f.client.recipes, 'get').mockImplementationOnce(async () => { await gate.promise; return f.recipe!; });
  await page.wrapper.get('[data-choose]').trigger('click'); await flushPromises(); await page.unload(); gate.resolve(null); await flushPromises();
  expect(page.wrapper.find('[data-protected]').exists()).toBe(false); expect(page.wrapper.text()).not.toContain('家常汤');
});
test.each(['index', 'edit'] as const)('%s uses actual typography scaling without treating jsdom as native rendering evidence', async name => {
  Object.assign(uni, { getAppBaseInfo: () => ({ fontSizeSetting: 22.4, fontSizeScaleFactor: 1.4 }) }); const f = await fixture(); const page = await render(name, f);
  expect(page.wrapper.get('page-meta').attributes('root-font-size')).toBe('22.4px');
});
test('late confirmation after hide or changed scope cannot remove or navigate', async () => {
  const f = await fixture(); const row = await f.add(); const page = await render('edit', f, { id: row.id }); const gate = deferCall();
  modal.mockImplementationOnce(async () => { await gate.promise; return { confirm: true, cancel: false }; }); await page.wrapper.get('[data-remove]').trigger('click'); await flushPromises();
  await page.hide(); await page.show(); gate.resolve(null); await flushPromises(); expect(await f.client.planning.get(row.id)).toMatchObject({ version: 1 }); expect(navigation).toEqual([]);
});
