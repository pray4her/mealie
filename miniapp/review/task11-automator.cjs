/* global getCurrentPages */
// Shared WeChat devtools automation helpers for the #11 evidence scripts.
// HOME_UI_REVIEW_V11_ONLY is NOT asserted here: this module is used by both the ui-review capture
// and the real-cloud flow. It never contacts a cloud object itself.
//
// Measured constraints (devtools + miniprogram-automator 0.13.0):
//  - Attribute selectors do not work; use class selectors.
//  - Descendant selectors cannot cross virtualHost components, so inner buttons are not tappable.
//    Clicks go through compiled event ids, which run the same guarded handler a tap runs.
//  - Page data keys are minified; assert on rendered content, never on key names.
//  - reLaunch re-runs the page lifecycle; switchTab to the current tab does not.
//  - The compiler REUSES event ids across handlers (planning/edit: change-recipe and the servings
//    input are both "b8", so the page carries e0_b8 and e6_b8). call() resolves by id suffix and
//    would silently run the wrong one. Inputs are therefore driven by element.trigger(), which
//    goes through the element's own binding and needs no id.
//  - Id selectors DO work (`#targetServings`); attribute selectors do not.
const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = process.env.WECHAT_DEVTOOLS_CLI || 'E:/Tencent/微信web开发者工具/cli.bat';
const DEVTOOLS_DIR = path.dirname(CLI);
const ELECTRON = path.join(DEVTOOLS_DIR, '微信开发者工具.exe');
const CLI_JS = path.join(DEVTOOLS_DIR, 'resources/app.asar.unpacked/js/common/cli/index.js');
// automator.launch() spawns cli.bat without a shell (fails on Windows); cmd.exe mangles the
// non-ASCII install path. Replicate cli.bat's own bootstrap and spawn Electron directly.
const BOOTSTRAP_JS = "const e=process.argv[1],a=process.argv.slice(2).filter(function(x){return x!=='--electron'});if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,'--ms-enable-electron-run-as-node',e,'--electron'].concat(a);require(e)";

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(1500); }
  throw new Error('timeout: ' + label);
}

function cliAuto(project, port) {
  const r = spawnSync(ELECTRON, ['-e', BOOTSTRAP_JS, CLI_JS, 'auto', '--project', project, '--auto-port', String(port), '--disable-gpu'], {
    cwd: DEVTOOLS_DIR, encoding: 'utf8', timeout: 240000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON: '', cwd: process.cwd() },
  });
  if (r.status !== 0) throw new Error('devtools auto failed: ' + r.status + ' ' + ((r.stderr || r.stdout || '') + (r.error ? r.error.message : '')).slice(-500));
  // The IDE hands out a different port when the requested one is still held by another window.
  const m = /"autoPort":\s*(\d+)/.exec(r.stdout || '');
  return m ? m[1] : String(port);
}

// Same regexes as extract-handlers.cjs, computed per page so ids never drift between builds.
function handlerMap(base, page) {
  const wxml = fs.readFileSync(path.join(base, page + '.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(base, page + '.js'), 'utf8');
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

// Resolve any compiled event binding (not just bindclick) for the tag carrying a given data-* attribute.
// Needed for the native <picker mode="date"> whose bindchange is not covered by extract-handlers.cjs.
function bindId(base, page, attr, event) {
  const wxml = fs.readFileSync(path.join(base, page + '.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(base, page + '.js'), 'utf8');
  const tags = wxml.match(/<[a-z-]+[^>]*>/g) || [];
  // Bare attributes compile without '=' (e.g. `data-query`), so accept '=', whitespace or '>'.
  const attrRe = new RegExp('data-' + attr + '(?:=|\\s|>)');
  const tag = tags.find(t => attrRe.test(t) && t.includes('bind' + event + '="{{'));
  if (!tag) return null;
  const bind = (tag.match(new RegExp('bind' + event + '="\\{\\{([A-Za-z]+)\\}\\}"')) || [])[1];
  if (!bind) return null;
  return (js.match(new RegExp(bind + ':\\s*[\\w.$]*o\\([\\s\\S]*?,\\s*"([a-z0-9]+)"\\)')) || [])[1] || null;
}

async function createSession({ project, port, base, out }) {
  fs.mkdirSync(out, { recursive: true });
  let actualPort = String(port);
  let mp = await automator.connect({ wsEndpoint: 'ws://localhost:' + actualPort }).catch(() => null);
  if (!mp) {
    actualPort = cliAuto(project, actualPort);
    mp = await until(() => automator.connect({ wsEndpoint: 'ws://localhost:' + actualPort }).catch(() => null), 120000, 'connect');
  }

  const pg = () => mp.currentPage();
  const count = async cls => (await (await pg()).$$('.' + cls)).length;
  const wxml = async () => { const el = await (await pg()).$('.page'); return el ? await el.outerWxml() : ''; };
  const includes = async needle => (await wxml()).includes(needle);
  const textOf = async cls => { const el = await (await pg()).$('.' + cls); return el ? (await el.text()).trim() : ''; };
  const valueOf = async cls => { const el = await (await pg()).$('.' + cls); return el ? await el.value() : null; };
  const typeInto = async (selector, value) => {
    const el = await (await pg()).$(selector);
    if (!el) throw new Error('no input ' + selector);
    await el.trigger('input', { value });
    await sleep(800);
  };
  const state = () => pg().then(p => p.data());
  const route = async () => (await pg()).path;
  const visibleText = async () => (await wxml()).replace(/<[^>]*>/g, '|').replace(/\|+/g, '|');
  const shot = async name => { const file = name + '.png'; await mp.screenshot({ path: path.join(out, file) }); return file; };

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
  const handlers = page => handlerMap(base, page);
  const bind = (page, attr, event) => bindId(base, page, attr, event);

  // v-for bindclick is per-instance data ({{row.c}} / {{meal.d}} / {{date.f}}). The instance's handler id
  // suffix equals its data-* value, so locate the page-data object holding that value and keep only
  // candidates that really are page method ids. Ambiguity is an error, never a guess.
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
  // Compiled WXML keeps data-* as templates (data-edit="{{row.h}}"), so ids cannot be grepped from
  // markup. uni-app names each v-for handler after its data-* value, which makes the live method list
  // the authoritative source for entry ids.
  const entryIds = async () => [...new Set((await methodIds()).filter(id => /^[a-f0-9]{32}$/.test(id)))];
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

  const goto = async target => {
    await mp.reLaunch('/' + target);
    const pathOnly = target.split('?')[0];
    await until(async () => (await mp.currentPage()).path === pathOnly, 60000, 'route ' + pathOnly);
  };
  // Boot runs login -> default tab and can override an early navigation, so retry until the tab sticks.
  const settle = async (tab = 'pages/recipes/index') => {
    for (let i = 0; i < 8; i++) {
      await mp.reLaunch('/' + tab).catch(() => {});
      const ok = await until(async () => (await mp.currentPage()).path === tab, 20000, 'settle').catch(() => null);
      if (ok) { await sleep(2000); return; }
    }
    throw new Error('boot never settled on ' + tab);
  };

  return { mp, port: actualPort, project, base, out, sleep, until, pg, count, wxml, includes, textOf, valueOf,
    typeInto, state, route, visibleText, shot, call, callByValue, chooseFirst, handlers, bind, goto, settle, methodIds,
    entryIds };
}

module.exports = { createSession, handlerMap, bindId, cliAuto, until, sleep, CLI, DEVTOOLS_DIR };
