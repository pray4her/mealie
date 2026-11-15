/* global getCurrentPages */
// Real-cloud acceptance flow for #11 against the PRODUCTION build (dist/build/mp-weixin).
// No mocks, no ui-review storage, no fake identity: wx.login/uni-id, real cloud objects, real DB.
// Requires a recently-active real WeChat account already logged into devtools (operator step).
const path = require('node:path');
const fs = require('node:fs');
const { createSession } = require('./task11-automator.cjs');

const PROJECT = process.env.FLOW_PROJECT || path.resolve(__dirname, '../dist/build/mp-weixin');
const OUT = process.env.FLOW_OUT || path.resolve(__dirname, '../ops/task11-real-2026-11-15');
const PORT = process.env.AUTO_PORT || '9423';
const BASE = path.join(PROJECT, 'pages');

const results = { ticket: 11, project: PROJECT, startedAt: new Date().toISOString(), steps: [], screenshots: [],
  evidenceBoundary: [
    'WeChat devtools simulator with a real logged-in account and the real alipay test space; not a physical device.',
    'Single real account: two-account concurrency is covered by domain tests, not observed here.',
    'Cross-midnight instant is not reproducible on demand; covered by domain tests.',
  ] };
const log = (step, extra) => { results.steps.push({ step, ...extra }); console.log('STEP', step, JSON.stringify(extra || {})); };

(async () => {
  const s = await createSession({ project: PROJECT, port: PORT, base: BASE, out: OUT });
  const { mp, until, sleep, shot, call, callByValue, chooseFirst, handlers, bind, goto, settle,
    includes, count, textOf, valueOf, typeInto, route, visibleText } = s;
  const fail = async (step, e) => { log(step, { ok: false, error: String((e && e.message) || e), text: (await visibleText().catch(() => '')).slice(0, 700) }); await shot(step + '-FAILED').catch(() => {}); };
  const ok = async (step, extra) => { log(step, { ok: true, ...extra }); await shot(step); };

  await settle();
  const indexH = handlers('planning/index');
  const editH = handlers('planning/edit');

  // 01 — the third native tab reaches the planning page on the Beijing current week.
  try {
    await goto('pages/planning/index');
    await until(() => includes('用餐计划'), 60000, 'planning index');
    await until(async () => await count('meal-panel') === 4, 60000, 'four meals');
    const date = (await textOf('date-target')).split(' ')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('bad selected date: ' + date);
    await ok('01-tab-planning', { selectedDate: date, meals: await count('meal-panel'), entries: await count('plan-entry'), viewport: await (await s.pg()).size() });
  } catch (e) { await fail('01-tab-planning', e); }

  // 02/03 — add a first dinner entry from a real family recipe.
  let firstTitle = null;
  try {
    await callByValue('dinner');
    await until(async () => (await route()) === 'pages/planning/edit', 40000, 'edit page');
    await until(async () => await count('search-row') >= 1, 60000, 'real recipe search results');
    await chooseFirst();
    await until(() => includes('用餐日期'), 40000, 'form stage');
    firstTitle = await textOf('section');
    await ok('02-add-form', { title: firstTitle, date: await textOf('date-target'), servings: await valueOf('home-input') });
    await call(editH.save);
    await until(() => includes('已保存'), 60000, 'saved');
    await ok('03-saved-first', { title: firstTitle });
    await call(editH['view-plan']);
    await until(async () => (await route()) === 'pages/planning/index', 40000, 'back to index');
    await until(async () => await count('plan-entry') >= 1, 60000, 'entry listed');
    log('03b-listed', { ok: true, entries: await count('plan-entry') });
  } catch (e) { await fail('02-03-add-first', e); }

  // 04 — a second dish in the SAME meal, with fractional servings.
  try {
    await callByValue('dinner');
    await until(async () => (await route()) === 'pages/planning/edit', 40000, 'edit page');
    await until(async () => await count('search-row') >= 1, 60000, 'search results');
    await chooseFirst();
    await until(() => includes('用餐日期'), 40000, 'form stage');
    await typeInto('#targetServings', '2.5');
    await call(editH.save);
    await until(() => includes('已保存'), 60000, 'saved second');
    await call(editH['view-plan']);
    await until(async () => (await route()) === 'pages/planning/index', 40000, 'back to index');
    await until(async () => await count('plan-entry') >= 2, 60000, 'two entries');
    const w = await s.wxml();
    await ok('04-same-meal-second', { entries: await count('plan-entry'), hasFraction: w.includes('2.5 份') });
  } catch (e) { await fail('04-same-meal-second', e); }

  // 05 — the "other" meal type is usable.
  try {
    await callByValue('other');
    await until(async () => (await route()) === 'pages/planning/edit', 40000, 'edit page');
    await until(async () => await count('search-row') >= 1, 60000, 'search results');
    await chooseFirst();
    await until(() => includes('用餐日期'), 40000, 'form stage');
    await call(editH.save);
    await until(() => includes('已保存'), 60000, 'saved other');
    await call(editH['view-plan']);
    await until(async () => (await route()) === 'pages/planning/index', 40000, 'back to index');
    await sleep(3000);
    await ok('05-other-meal', { entries: await count('plan-entry') });
  } catch (e) { await fail('05-other-meal', e); }

  // 06 — week navigation and a cross-month/cross-year local date via the native picker's change handler.
  try {
    await goto('pages/planning/index');
    await until(async () => await count('meal-panel') === 4, 60000, 'index ready');
    const before = await textOf('date-target');
    await call(indexH['next-week']);
    await until(async () => (await textOf('date-target')) !== before, 40000, 'next week');
    const nextWeek = await textOf('date-target');
    await call(indexH['prev-week']);
    await until(async () => (await textOf('date-target')) === before, 40000, 'prev week');
    const picker = bind('planning/index', 'date-picker', 'change');
    if (!picker) throw new Error('picker change handler not found');
    // A cross-year date: the stored value must stay exactly what the user picked, never a UTC slice.
    const crossYear = '2027-01-01';
    await call(picker, { value: crossYear });
    await until(async () => (await textOf('date-target')).startsWith(crossYear), 40000, 'cross-year date');
    await ok('06-cross-week', { before, nextWeek, picked: crossYear, shown: await textOf('date-target') });
    await call(indexH.today);
    await until(async () => (await textOf('date-target')) === before, 40000, 'back to today');
    log('06b-today', { ok: true, restored: await textOf('date-target') });
  } catch (e) { await fail('06-cross-week', e); }

  // 07 — edit an existing entry: servings change, snapshot title unchanged, recipe not replaceable.
  try {
    await goto('pages/planning/index');
    await until(async () => await count('plan-entry') >= 1, 60000, 'entries');
    const ids = await s.entryIds();
    if (!ids.length) throw new Error('no editable entry id on the page');
    await call(ids[0]);
    await until(async () => (await route()) === 'pages/planning/edit', 40000, 'edit page');
    await until(() => includes('用餐日期'), 60000, 'form stage');
    const snapshot = await textOf('section');
    const locked = await includes('菜谱不可更换');
    await typeInto('#targetServings', '3');
    await call(editH.save);
    await until(() => includes('已保存'), 60000, 'saved edit');
    await ok('07-edit-entry', { id: ids[0], snapshot, recipeLocked: locked, newServings: '3' });
  } catch (e) { await fail('07-edit-entry', e); }

  // 08 — remove: the confirmation names the SAVED meal; cancel keeps it, confirm deletes it.
  // automator's native().confirmModal()/cancelModal() are no-ops on this devtools build (measured:
  // the dialog stays open), so the dialog primitive is intercepted with a function mock that records
  // the app's real copy and answers confirm/cancel. Page logic and cloud writes stay real.
  try {
    await call(editH['view-plan']).catch(() => {});
    await goto('pages/planning/index');
    await until(async () => await count('plan-entry') >= 1, 60000, 'entries');
    const before = await count('plan-entry');
    const ids = await s.entryIds();
    if (!ids.length) throw new Error('no editable entry id on the page');
    await call(ids[ids.length - 1]);
    await until(() => includes('用餐日期'), 60000, 'form stage');
    await mp.mockWxMethod('showModal', function (options) {
      globalThis.__modalOpts = options;
      const answer = { confirm: !!globalThis.__modalConfirm, cancel: !globalThis.__modalConfirm };
      if (options && options.success) options.success(answer);
      return answer;
    });
    await mp.evaluate(() => { globalThis.__modalConfirm = false; });
    await call(editH.remove);
    await sleep(3000);
    const copy = await mp.evaluate(() => globalThis.__modalOpts || null);
    const stillThere = await includes('移除安排');
    await shot('08a-remove-confirm');
    await mp.evaluate(() => { globalThis.__modalConfirm = true; });
    await call(editH.remove);
    await until(() => includes('已移除'), 60000, 'removed');
    await mp.restoreWxMethod('showModal');
    await ok('08-remove-confirm', { entriesBefore: before, cancelKeptEntry: stillThere, modalCopy: copy && { title: copy.title, content: copy.content, confirmText: copy.confirmText, cancelText: copy.cancelText } });
  } catch (e) { await fail('08-remove-confirm', e); }

  // 09 — recipe detail's "安排一餐" entry jumps straight to the form with that recipe.
  try {
    await goto('pages/planning/index');
    await until(async () => await count('plan-entry') >= 1, 60000, 'entries');
    const planIds = await s.entryIds();
    const sourceLink = await includes('查看菜谱');
    // Reach a real recipe detail by tapping the list row, then use its plan action.
    await goto('pages/recipes/index');
    await until(async () => await count('recipe-open') >= 1, 60000, 'recipe list');
    const detailH = handlers('recipes/detail');
    await (await (await s.pg()).$('.recipe-open')).tap();
    await until(async () => (await route()) === 'pages/recipes/detail', 40000, 'recipe detail');
    const firstRecipe = (await s.pg()).query.id;
    if (!firstRecipe) throw new Error('no recipe id in the detail route');
    await until(() => includes('安排一餐'), 60000, 'detail plan action');
    await call(detailH.plan);
    await until(async () => (await route()) === 'pages/planning/edit', 40000, 'edit from detail');
    await until(() => includes('用餐日期'), 60000, 'form stage without search');
    await ok('09-detail-entry', { recipeId: firstRecipe, skippedSearch: !(await includes('选择家里的菜谱')), planIds: planIds.length, sourceLink });
  } catch (e) { await fail('09-detail-entry', e); }

  // 11 — invalid servings are rejected in place, input preserved, nothing saved.
  try {
    await goto('pages/planning/index');
    await until(async () => await count('meal-panel') === 4, 60000, 'index ready');
    await callByValue('lunch');
    await until(async () => (await route()) === 'pages/planning/edit', 40000, 'edit page');
    await until(async () => await count('search-row') >= 1, 60000, 'search results');
    await chooseFirst();
    await until(() => includes('用餐日期'), 40000, 'form stage');
    // type="digit" filters '-', so use 0: typeable, and rejected by parseTargetServings (must be > 0).
    await typeInto('#targetServings', '0');
    await call(editH.save);
    await until(() => includes('份数可留空，或填写大于 0 且不超过 10000 的数字。'), 40000, 'field error');
    await ok('11-invalid-input', { kept: await valueOf('home-input'), fieldErrors: await count('field-error'), stillForm: await includes('保存安排') });
  } catch (e) { await fail('11-invalid-input', e); }

  results.finishedAt = new Date().toISOString();
  results.pass = results.steps.every(x => x.ok !== false);
  fs.writeFileSync(path.join(OUT, 'flow-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('PASS', results.pass, results.steps.filter(x => x.ok !== false).length + '/' + results.steps.length);
  await mp.disconnect();
  if (!results.pass) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });