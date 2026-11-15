/* global getCurrentPages */
// HOME_UI_REVIEW_V11_ONLY: WeChat devtools capture of the planning pages against the isolated review fixture.
// Never a production entry point; never contacts a cloud object.
//
// Runtime facts this script depends on (all measured against devtools + automator 0.13.0):
//  - Attribute selectors do NOT work (`[data-plan-entry]` returns 0 even though the WXML has it). Use classes.
//  - Descendant selectors into components do NOT work (`.search-row button` returns 0). HomeAction is virtualHost.
//  - Page data keys are minified, so readiness must be asserted on rendered content, never on key names.
//  - Clicks therefore go through compiled event ids; v-for ids are per-instance and resolved from page data.
//  - reLaunch re-runs the page lifecycle; switchTab to the already-current page does not.
const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OUT = path.resolve(__dirname, '../ops/task11-local');
const PORT = process.env.AUTO_PORT || '9421';
const WIDTH = process.env.CAP_WIDTH || '390';
const FONT = Number(process.env.CAP_FONT || '1');
const CLI = 'E:/Tencent/微信web开发者工具/cli.bat';
const PROJECT = process.env.CAP_PROJECT || path.resolve(__dirname, '../dist/ui-review/mp-weixin');
const BASE = process.env.CAP_BASE || path.join(PROJECT, 'pages');
const ONLY = process.env.CAP_ONLY ? process.env.CAP_ONLY.split(',') : null;
// review/app-client.ts seeds ids as (++planSequence).toString(16).padStart(32, 'a'); the first is 31 a's + '1'.
const SEED_ID = '1'.padStart(32, 'a');

fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(1500); }
  throw new Error('timeout: ' + label);
}

// automator.launch() spawns cli.bat without a shell (fails on Windows) and cmd.exe mangles the non-ASCII
// install path, so replicate cli.bat's own bootstrap and spawn the Electron binary directly.
const DEVTOOLS_DIR = path.dirname(CLI);
const ELECTRON = path.join(DEVTOOLS_DIR, '微信开发者工具.exe');
const CLI_JS = path.join(DEVTOOLS_DIR, 'resources/app.asar.unpacked/js/common/cli/index.js');
const BOOTSTRAP_JS = "const e=process.argv[1],a=process.argv.slice(2).filter(function(x){return x!=='--electron'});if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,'--ms-enable-electron-run-as-node',e,'--electron'].concat(a);require(e)";
function cliAuto() {
  const r = spawnSync(ELECTRON, ['-e', BOOTSTRAP_JS, CLI_JS, 'auto', '--project', PROJECT, '--auto-port', PORT, '--disable-gpu'], {
    cwd: DEVTOOLS_DIR, encoding: 'utf8', timeout: 240000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON: '', cwd: process.cwd() },
  });
  // The IDE may hand out a different port when the requested one is still held by another window.
  const m = /"autoPort":\s*(\d+)/.exec(r.stdout || '');
  if (r.status !== 0) throw new Error('devtools auto failed: ' + r.status + ' ' + ((r.stderr || r.stdout || '') + (r.error ? r.error.message : '')).slice(-500));
  return m ? m[1] : PORT;
}

// Same regexes as extract-handlers.cjs, computed per page at runtime so ids never drift between builds.
function handlerMap(page) {
  const wxml = fs.readFileSync(path.join(BASE, page + '.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(BASE, page + '.js'), 'utf8');
  const map = {};
  for (const tag of wxml.match(/<home-action[^>]*>/g) || []) {
    const data = (tag.match(/data-([a-z-]+)=/) || [])[1];
    const bind = (tag.match(/bindclick="\{\{([A-Za-z]+)\}\}"/) || [])[1];
    if (!bind) continue;
    const id = (js.match(new RegExp(bind + ':\\s*[\\w.$]*o\\([\\s\\S]*?,\\s*"([a-z0-9]+)"\\)')) || [])[1];
    if (data && id) map[data] = id;
  }
  return map;
}

// uni caches wx.getAppBaseInfo() at app-service boot, and this devtools build reports an inverted
// scale (0.8 at text size 23) that use-page-typography clamps to 1, so neither the IDE text size nor
// post-boot mockWxMethod can express a large font. The REVIEW artifact therefore gets a boot-time
// shim, installed before the IDE launches. This is a MOCK, not a physical system setting, and it
// never touches the production build.
const SHIM_MARK = '/* HOME_UI_REVIEW_FONT_SHIM */';
function installFontShim() {
  const file = path.join(PROJECT, 'app.js');
  let src = fs.readFileSync(file, 'utf8');
  const line = SHIM_MARK + '(function(){var f=' + FONT + ';var o=wx.getAppBaseInfo?wx.getAppBaseInfo.bind(wx):null;wx.getAppBaseInfo=function(){var b=o?o():{};b.fontSizeScaleFactor=f;b.fontSizeSetting=Math.round(16*f*10)/10;return b;};})();';
  if (src.startsWith(line + '\n')) return;
  const at = src.indexOf(SHIM_MARK);
  if (at >= 0) src = src.slice(0, at) + src.slice(src.indexOf('\n', at) + 1);
  fs.writeFileSync(file, line + '\n' + src);
}


(async () => {
  installFontShim();
  let port = PORT;
  let mp = await automator.connect({ wsEndpoint: 'ws://localhost:' + port }).catch(() => null);
  if (!mp) { port = cliAuto(); mp = await until(() => automator.connect({ wsEndpoint: 'ws://localhost:' + port }).catch(() => null), 120000, 'connect'); }
  // No idle gap here: a pause between connect and the first automator call lets the backgrounded
  // simulator latch into throttling and every later call times out.
  console.log('BOOT connected port', port);

  const results = {
    width: WIDTH, font: FONT, project: PROJECT, autoPort: port,
    platform: 'WeChat devtools simulator / ui-review fixture',
    startedAt: new Date().toISOString(), cases: [], screenshots: [],
    evidenceBoundary: [
      'ui-review mock client: no cloud, no real identity, no real WeChat API proof.',
      'Font scale is a boot-time mock shim in the review artifact (uni caches base info at boot; devtools reports an inverted scale). Not a physical system setting.',
      'Simulator screenshots, not a physical device.',
      'Logical width comes from the IDE device selector; every case records the measured viewport.',
    ],
  };
  const shot = async name => {
    const file = `wechat-${name}-${WIDTH}-f${FONT}.png`;
    await mp.screenshot({ path: path.join(OUT, file) });
    results.screenshots.push(file);
  };

  const pg = () => mp.currentPage();
  const count = async cls => (await (await pg()).$$('.' + cls)).length;
  const wxml = async () => { const el = await (await pg()).$('.page'); return el ? await el.outerWxml() : ''; };
  const includes = async needle => (await wxml()).includes(needle);
  const textOf = async cls => { const el = await (await pg()).$('.' + cls); return el ? (await el.text()).trim() : ''; };
  const valueOf = async cls => { const el = await (await pg()).$('.' + cls); return el ? await el.value() : null; };
  const state = () => pg().then(p => p.data());
  const route = async () => (await pg()).path;

  // Invokes the same guarded handler a tap runs.
  const call = (id, detail) => mp.evaluate((id, detail) => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    const key = Object.keys(p).find(k => typeof p[k] === 'function' && k.endsWith('_' + id));
    if (!key) return { ok: false, id, route: p.route };
    p[key].call(p, { type: 'tap', detail: detail || {}, target: { dataset: {} }, currentTarget: { dataset: {} } });
    return { ok: true };
  }, id, detail);
  const methodIds = () => mp.evaluate(() => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    return Object.keys(p).filter(k => typeof p[k] === 'function').map(k => k.split('_').pop());
  });
  // v-for bindclick is per-instance data ({{row.c}} / {{meal.d}} / {{date.f}}). The instance's handler id
  // suffix equals its data-* value, so locate the page-data object holding that value and verify the
  // candidate really is a page method id. Ambiguity is an error, never a guess.
  async function callByValue(value, detail) {
    if (value === null || value === undefined) throw new Error('callByValue: missing value');
    const ids = await methodIds();
    const found = [];
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (!Array.isArray(n)) {
        const vs = Object.values(n);
        if (vs.includes(value)) for (const v of vs) if (typeof v === 'string' && ids.includes(v)) found.push(v);
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(await state());
    const unique = [...new Set(found)];
    // The instance's handler id suffix equals its data-* value, so an exact match wins over
    // same-object neighbours (e.g. a meal row also carries the selected date, which is itself an id).
    const pick = unique.includes(value) ? value : unique.length === 1 ? unique[0] : null;
    if (!pick) throw new Error('ambiguous handler for ' + value + ': ' + JSON.stringify(unique));
    const r = await call(pick, detail);
    if (!r || r.ok !== true) throw new Error('handler not found for ' + value + ': ' + JSON.stringify(r));
    return r;
  }
  // First search result: the first 32-hex recipe id that is also a live handler id suffix.
  async function chooseFirst() {
    const ids = await methodIds();
    let hit = null;
    const walk = n => {
      if (hit || !n || typeof n !== 'object') return;
      if (!Array.isArray(n)) {
        for (const v of Object.values(n)) if (typeof v === 'string' && /^[a-f0-9]{32}$/.test(v) && ids.includes(v)) { hit = v; return; }
      }
      for (const v of Object.values(n)) walk(v);
    };
    walk(await state());
    if (!hit) throw new Error('no selectable search row found');
    return call(hit);
  }

  // Element.input() sets the value but does NOT fire uni-app's compiled bindinput. trigger() goes
  // through the element's own binding, which also sidesteps the compiler's reused event ids:
  // planning/edit registers change-recipe AND the servings input as "b8" (e0_b8 / e6_b8), so an
  // id-based call in the add flow runs change-recipe and drops back to the search stage.
  const typeInto = async (selector, value) => {
    const el = await (await pg()).$(selector);
    if (!el) throw new Error('no input ' + selector);
    await el.trigger('input', { value });
    await sleep(800);
  };
  // A pending intent is persisted in uni storage and survives reLaunch, so write-driven scenes must
  // start from a clean slate or they inherit the previous scene's unconfirmed request.
  const PENDING_KEY = 'home.planning.pending.v1:ui-review-owner';
  const clearPending = () => mp.callWxMethod('removeStorageSync', PENDING_KEY).catch(() => {});

  // Records what the boot actually reported (with the shim in place); the shim is the font source.
  // callWxMethod('getAppBaseInfo') hangs under the shim, so read the fields through evaluate.
  const applyFont = async () => {
    const info = await mp.systemInfo();
    const base = await mp.evaluate(() => { const b = wx.getAppBaseInfo(); return { fontSizeSetting: b.fontSizeSetting, fontSizeScaleFactor: b.fontSizeScaleFactor }; });
    return { systemFontSizeSetting: info.fontSizeSetting, wxFontSizeSetting: base.fontSizeSetting, wxFontSizeScaleFactor: base.fontSizeScaleFactor };
  };
  // The fixture seeds lazily on first planning access, so a scenario written after boot still takes effect.
  // No restart is used: the devtools simulator wipes storage across restarts.
  const scene = async (planning, extra = {}) => {
    await mp.callWxMethod('setStorageSync', 'home.ui-review.v11', { ...extra, planning });
  };
  const goto = async target => {
    await mp.reLaunch('/' + target);
    const pathOnly = target.split('?')[0];
    await until(async () => (await mp.currentPage()).path === pathOnly, 60000, 'route ' + pathOnly);
  };
  // Boot runs login -> default tab and can override an early navigation, so retry until the tab sticks.
  const settle = async () => {
    // Handshake first: with the font shim active, opening with reLaunch instead of currentPage wedges.
    await mp.currentPage().catch(() => {});
    for (let i = 0; i < 8; i++) {
      console.log('BOOT settle attempt', i);
      await mp.reLaunch('/pages/recipes/index').catch(e => console.log('BOOT reLaunch err', e.message));
      const ok = await until(async () => (await mp.currentPage()).path === 'pages/recipes/index', 20000, 'settle').catch(() => null);
      if (ok) { await sleep(2000); return; }
    }
    throw new Error('boot never settled on recipes/index');
  };

  // Throttled simulators time out the first automator calls; retry the bootstrap. On an already-booted
  // live session the per-scene readiness checks are sufficient, so settle can be skipped entirely.
  if (!process.env.CAP_SKIP_SETTLE) {
    for (let i = 0; ; i++) {
      try { await settle(); break; } catch (e) {
        if (i >= 2) throw e;
        await sleep(4000);
      }
    }
  }
  results.baseInfo = { reported: await applyFont(), shimScale: FONT, ideTextSize: Number(process.env.CAP_IDE_FONT || 16) };

  const SCENES = [
    { name: 'index-empty', route: 'pages/planning/index', planning: { seed: 'empty' },
      ready: () => includes('还没有安排，添加一道家常菜吧。'),
      checks: [async () => await count('plan-entry') === 0, async () => await count('meal-panel') === 4] },
    { name: 'index-populated', route: 'pages/planning/index', planning: { seed: 'populated' },
      ready: async () => await count('plan-entry') === 4,
      checks: [async () => await count('meal-panel') === 4,
        async () => await includes('份数未注明'), async () => await includes('2.5 份'),
        async () => await includes('编辑安排'), async () => await includes('查看菜谱')] },
    { name: 'index-long', route: 'pages/planning/index', planning: { seed: 'long' },
      ready: () => includes('一家人周末'),
      checks: [async () => {
        const el = await (await pg()).$('.plan-entry'); const s = await el.size(); const v = await (await pg()).size();
        return s.width <= v.width;
      }] },
    { name: 'index-source-unavailable', route: 'pages/planning/index', planning: { seed: 'populated', source: 'unavailable' },
      ready: () => includes('菜谱已不可用，保留安排快照'),
      checks: [async () => await count('plan-entry') === 4, async () => !(await includes('查看菜谱'))] },
    { name: 'index-pagination', route: 'pages/planning/index', planning: { seed: 'pagination' },
      ready: async () => await count('plan-entry') === 20,
      checks: [async () => await includes('继续加载当天安排')],
      after: async () => { await call(handlerMap('planning/index').more); await until(async () => await count('plan-entry') === 21, 30000, 'page 2'); },
      post: [async () => !(await includes('继续加载当天安排'))] },
    { name: 'index-read-failure', route: 'pages/planning/index', planning: { seed: 'populated', read: 'failure' },
      ready: () => includes('暂时无法读取或确认结果'),
      checks: [async () => await includes('重新读取安排')] },
    { name: 'index-week-cross', route: 'pages/planning/index', planning: { seed: 'populated' },
      ready: async () => await count('meal-panel') === 4,
      checks: [async () => /^\d{4}-\d{2}-\d{2} · 选日期$/.test(await textOf('date-target'))],
      after: async () => {
        const before = await textOf('date-target');
        await call(handlerMap('planning/index')['next-week']);
        await until(async () => (await textOf('date-target')) !== before, 30000, 'next week');
        await call(handlerMap('planning/index')['prev-week']);
        await until(async () => (await textOf('date-target')) === before, 30000, 'prev week back');
        await call(handlerMap('planning/index').today);
        await sleep(2500);
      },
      post: [async () => /^\d{4}-\d{2}-\d{2} · 选日期$/.test(await textOf('date-target')),
        async () => await includes('今天')] },
    { name: 'edit-search', route: 'pages/planning/edit', planning: {},
      ready: async () => await count('search-row') === 4,
      checks: [async () => await includes('选择家里的菜谱'), async () => await includes('选择这道菜')] },
    { name: 'edit-search-no-match', route: 'pages/planning/edit', planning: {},
      ready: async () => await count('search-row') === 4,
      after: async () => {
        await typeInto('.home-input', '不存在的菜名xyz');
        await call(handlerMap('planning/edit').search);
        await until(() => includes('没有匹配的菜谱，请换个关键词。'), 30000, 'no match');
      },
      post: [async () => await count('search-row') === 0] },
    { name: 'edit-search-empty-family', route: 'pages/planning/edit', planning: { seed: 'empty' }, extra: { recipes: 'empty' },
      ready: () => includes('家庭还没有菜谱，请先到菜谱页添加。'),
      checks: [async () => await count('search-row') === 0] },
    { name: 'edit-form', route: 'pages/planning/edit', planning: {},
      ready: async () => await count('search-row') >= 1,
      after: async () => { await chooseFirst(); await until(() => includes('用餐日期'), 30000, 'form stage'); },
      post: [async () => /^\d{4}-\d{2}-\d{2} · 选择日期$/.test(await textOf('date-target')),
        async () => await includes('晚餐，已选中'),
        async () => await includes('目标份数（可留空）'),
        async () => await includes('保存安排')] },
    { name: 'edit-field-error', route: 'pages/planning/edit', planning: {},
      ready: async () => await count('search-row') >= 1,
      after: async () => {
        await chooseFirst(); await until(() => includes('用餐日期'), 30000, 'form stage');
        // type="digit" filters '-', so '-1' would silently become valid '1'. 0 is typeable and rejected (>0 required).
        await typeInto('#targetServings', '0');
        await call(handlerMap('planning/edit').save);
        await until(() => includes('份数可留空，或填写大于 0 且不超过 10000 的数字。'), 30000, 'field error');
      },
      post: [async () => await count('field-error') >= 1, async () => await valueOf('home-input') === '0',
        async () => await includes('请检查标出的字段。')] },
    { name: 'edit-conflict', route: 'pages/planning/edit?id=' + SEED_ID, planning: { seed: 'populated', write: 'conflict' },
      ready: () => includes('用餐日期'),
      after: async () => {
        await typeInto('#targetServings', '4');
        await call(handlerMap('planning/edit').save);
        await until(() => includes('其他成员或家庭关系已发生变化'), 30000, 'conflict');
      },
      post: [async () => await valueOf('home-input') === '4', async () => await includes('重新加载安排')] },
    { name: 'edit-remove-confirm', route: 'pages/planning/edit?id=' + SEED_ID, planning: { seed: 'populated' },
      ready: () => includes('用餐日期'),
      checks: [async () => await includes('移除安排')],
      after: async () => {
        await call(handlerMap('planning/edit').remove); await sleep(2500);
        await mp.native().cancelModal(); await sleep(2500);
      },
      post: [async () => await includes('移除安排'), async () => await includes('保存安排')] },
    { name: 'edit-source-unavailable', route: 'pages/planning/edit?id=' + SEED_ID, planning: { seed: 'long', source: 'unavailable' },
      ready: () => includes('菜谱已不可用，保留原安排快照'),
      checks: [async () => await includes('保存安排'), async () => await includes('移除安排'),
        async () => await includes('一家人周末')] },
    // These four cannot be seeded: a pending intent only exists after a real UI write.
    { name: 'edit-committed', route: 'pages/planning/edit', planning: {}, reset: true,
      ready: async () => await count('search-row') >= 1,
      after: async () => {
        await chooseFirst(); await until(() => includes('用餐日期'), 30000, 'form stage');
        await call(handlerMap('planning/edit').save);
        await until(() => includes('已保存'), 40000, 'committed');
      },
      post: [async () => await includes('查看计划'), async () => !(await includes('保存安排'))] },
    { name: 'edit-pending', route: 'pages/planning/edit', planning: { write: 'lost-ack' }, reset: true,
      ready: async () => await count('search-row') >= 1,
      after: async () => {
        await chooseFirst(); await until(() => includes('用餐日期'), 30000, 'form stage');
        await call(handlerMap('planning/edit').save);
        await until(() => includes('结果尚未确认'), 40000, 'pending');
      },
      post: [async () => await includes('确认原请求结果')] },
    { name: 'index-pending', route: 'pages/planning/edit', planning: { write: 'lost-ack' }, reset: true,
      ready: async () => await count('search-row') >= 1,
      after: async () => {
        await chooseFirst(); await until(() => includes('用餐日期'), 30000, 'form stage');
        await call(handlerMap('planning/edit').save);
        await until(() => includes('结果尚未确认'), 40000, 'pending');
        await mp.reLaunch('/pages/planning/index');
        await until(() => includes('上次操作结果尚未确认'), 40000, 'index pending');
      },
      post: [async () => await includes('恢复原请求'),
        // A pending intent must block every meal's add action: invoking it cannot navigate away.
        async () => { await callByValue('dinner'); await sleep(2500); return await route() === 'pages/planning/index'; }] },
  ];

  for (const s of SCENES) {
    if (ONLY && !ONLY.includes(s.name)) continue;
    const c = { name: s.name, pass: false, checks: [] };
    try {
      await scene(s.planning, s.extra);
      // Every scene starts clean: a persisted pending intent survives reLaunch and would otherwise
      // replace the search stage with the recovery note. Write-driven scenes create their own afterwards.
      await clearPending();
      await goto(s.route);
      await until(s.ready, 60000, s.name + ' ready');
      const run = async (list, phase) => {
        for (const [i, fn] of (list || []).entries()) {
          const ok = await fn();
          c.checks.push({ phase, i, ok });
          if (!ok) throw new Error(`${phase} check ${i} failed`);
        }
      };
      await run(s.checks, 'pre');
      if (s.after) await s.after();
      await run(s.post, 'post');
      c.viewport = await (await pg()).size();
      c.rootFontSize = await mp.evaluate(() => { const p = getCurrentPages()[getCurrentPages().length - 1]; return p.data && p.data.a; });
      await shot(s.name);
      c.pass = true;
    } catch (e) {
      c.error = String((e && e.message) || e);
      try { c.visibleText = (await wxml()).replace(/<[^>]*>/g, '|').replace(/\|+/g, '|').slice(0, 900); } catch { /* page may be gone */ }
      await shot(s.name + '-FAILED').catch(() => {});
    }
    results.cases.push(c);
    console.log('CASE', s.name, c.pass, c.error || '');
  }

  results.finishedAt = new Date().toISOString();
  // A mislabeled font run is worse than a failed one: refuse to pass if the rendered root font does
  // not match the declared pass (standard = 16px everywhere, large = visibly scaled somewhere).
  const roots = [...new Set(results.cases.map(c => c.rootFontSize))];
  const fontOk = FONT === 1 ? roots.every(r => r === '16px') : roots.some(r => r !== '16px');
  results.fontCheck = { roots, ok: fontOk };
  results.pass = results.cases.length > 0 && results.cases.every(c => c.pass) && fontOk;
  fs.writeFileSync(path.join(OUT, `capture-results-${WIDTH}-f${FONT}.json`), JSON.stringify(results, null, 2) + '\n');
  console.log('PASS', results.pass, `${results.cases.filter(c => c.pass).length}/${results.cases.length}`);
  await mp.disconnect();
  if (!results.pass) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });