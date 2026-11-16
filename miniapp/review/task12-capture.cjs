// Isolated UI fixture only. No real identities, cloud calls or production artefact edits.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
process.env.WECHAT_DEVTOOLS_CLI ||= 'D:/微信web开发者工具/cli.bat';
const { createSession } = require('./task11-automator.cjs');
const project = path.resolve(process.env.CAP_PROJECT || 'dist/ui-review-task12/mp-weixin');
const out = path.resolve('ops/task12-local');
const width = Number(process.env.CAP_WIDTH || 390); const font = Number(process.env.CAP_FONT || 1);
const mark = '/* HOME_TASK12_REVIEW_FONT */'; const app = path.join(project, 'app.js');
let source = fs.readFileSync(app, 'utf8'); if (source.startsWith(mark)) source = source.slice(source.indexOf('\n') + 1);
const shim = mark + '(function(){var o=wx.getAppBaseInfo.bind(wx);wx.getAppBaseInfo=function(){var b=o();b.fontSizeScaleFactor=' + font + ';b.fontSizeSetting=' + 16 * font + ';return b;};})();\n';
fs.writeFileSync(app, shim + source);
const results = { ticket: 12, width, font, kind: 'WeChat developer-tool simulator with isolated UI fixture', fontSource: 'review-only boot shim, not a physical system setting', cases: [], screenshots: [] };
(async () => {
  const s = await createSession({ project, port: process.env.AUTO_PORT || '9512', base: path.join(project, 'pages'), out });
  console.log('CONNECTED', s.port);
  spawnSync('powershell.exe', ['-NoProfile', '-Command', "$p = Get-Process | Where-Object { $_.Path -eq 'D:\\微信web开发者工具\\微信开发者工具.exe' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }"], { windowsHide: true });
  const { mp, until, sleep, includes, goto: rawGoto, handlers, call, typeInto } = s;
  // Fixture scenes intentionally discard drafts; native leave confirmation is a separate device check.
  const goto = async route => { await mp.callWxMethod('disableAlertBeforeUnload').catch(() => {}); await rawGoto(route); };
  await mp.currentPage(); await mp.callWxMethod('disableAlertBeforeUnload').catch(() => {}); console.log('BOOT READY'); await s.settle('pages/shopping/index'); console.log('SETTLED');
  const scenario = async value => { await mp.callWxMethod('setStorageSync', 'home.ui-review.v11', { shopping: value }); await mp.callWxMethod('removeStorageSync', 'home.shopping.pending.v1:ui-review-owner'); };
  async function shot(name) {
    await sleep(500); const viewport = await (await s.pg()).size();
    const el = await (await s.pg()).$('.shopping-title'); const rootFont = el ? await el.style('font-size') : null;
    if (viewport.width !== width) throw new Error('actual viewport ' + viewport.width + ' differs from requested ' + width);
    if (Math.abs(parseFloat(rootFont) - 24 * font) > 0.1) throw new Error('title font did not reflect requested scale: ' + rootFont);
    const file = 'wechat-' + name + '-' + width + '-f' + font + '.png'; await mp.screenshot({ path: path.join(out, file) });
    results.cases.push({ name, viewport, titleFontSize: rootFont, pass: true }); results.screenshots.push(file); console.log('CAPTURE', name, JSON.stringify(viewport));
  }
  async function index(seed) { await scenario({ seed }); await goto('pages/shopping/index'); await until(() => includes(seed === 'empty' ? '还没有购物清单' : '这周的采购单'), 20000, seed); }
  async function form(route, needle) { await goto(route); await until(() => includes(needle), 20000, 'form ' + route); await sleep(700); }
  for (const seed of ['empty', 'list-only', 'populated', 'checked', 'long', 'pagination']) { await index(seed); await shot('index-' + seed); }
  await index('populated'); await call(handlers('shopping/index')['switch-list']); await sleep(400); await shot('list-picker');
  await form('pages/shopping/list-edit', '清单名称'); await shot('list-new');
  await form('pages/shopping/list-edit?id=' + '1'.padStart(32, 'c'), '清单名称'); await shot('list-edit');
  await form('pages/shopping/item-edit?listId=' + '1'.padStart(32, 'c'), '条目原文'); await shot('item-new');
  await call(handlers('shopping/item-edit').save); await until(() => includes('请检查标出的字段'), 20000, 'validation'); await shot('item-validation');
  await form('pages/shopping/item-edit?listId=' + '1'.padStart(32, 'c') + '&id=' + '1'.padStart(32, 'd'), '条目原文'); await shot('item-edit');
  await mp.callWxMethod('setStorageSync', 'home.ui-review.v11', { shopping: { seed: 'populated', write: 'conflict' } });
  await typeInto('#raw', '核对后仍需购买的新鲜食材'); await call(handlers('shopping/item-edit').save); await until(() => includes('家人已修改'), 20000, 'conflict'); await shot('item-conflict');
  await index('list-only'); await form('pages/shopping/item-edit?listId=' + '1'.padStart(32, 'c'), '条目原文');
  await mp.callWxMethod('setStorageSync', 'home.ui-review.v11', { shopping: { seed: 'list-only', write: 'lost-ack' } });
  await typeInto('#raw', '香菜适量'); await call(handlers('shopping/item-edit').save); await until(() => includes('原请求结果尚未确认'), 20000, 'pending'); await shot('item-pending');
  await call(handlers('shopping/item-edit').retry); await until(() => includes('已保存'), 20000, 'recovered'); await shot('item-recovered');
  await index('populated'); await mp.callWxMethod('setStorageSync', 'home.ui-review.v11', { shopping: { seed: 'populated', read: 'failure' } });
  await goto('pages/shopping/index'); await until(() => includes('读取失败') || includes('恢复原请求'), 20000, 'read failure'); await shot('index-read-failure');
  results.pass = true; fs.writeFileSync(path.join(out, 'capture-' + width + '-f' + font + '.json'), JSON.stringify(results, null, 2));
  await mp.disconnect();
})().catch(error => { results.pass = false; results.error = String(error.message || error); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'capture-' + width + '-f' + font + '.json'), JSON.stringify(results, null, 2)); console.error(error); process.exit(1); });
