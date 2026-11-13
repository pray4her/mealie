const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '../ops/task09-real-2026-11-14');
const SAMPLES = path.resolve(__dirname, '../dist/task09-samples');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(1500); }
  throw new Error('timeout: ' + label);
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9422' });
  const summary = { steps: [] };
  const log = (step, extra) => { summary.steps.push({ step, ...extra }); console.log('STEP', step, JSON.stringify(extra || {})); };
  const shot = name => mp.screenshot({ path: path.join(OUT, name + '.png') });
  const cur = () => mp.currentPage();
  const call = (id, detail) => mp.evaluate((id, detail) => {
    const p = getCurrentPages()[getCurrentPages().length - 1];
    const key = Object.keys(p).find(k => typeof p[k] === 'function' && k.endsWith('_' + id));
    const fn = key && p[key];
    if (typeof fn !== 'function') return { ok: false, id, route: p.route };
    fn.call(p, { type: 'tap', detail: detail || {}, target: { dataset: {} }, currentTarget: { dataset: {} } });
    return { ok: true };
  }, id, detail);
  const dataStr = () => mp.evaluate(() => JSON.stringify(getCurrentPages()[getCurrentPages().length - 1].data));
  const waitData = (needle, ms, label) => until(async () => (await dataStr()).includes(needle) ? needle : null, ms, label);
  const waitPage = (route, ms = 30000) => until(async () => { const p = await cur(); return p.path === route ? p : null; }, ms, 'page ' + route);
  const mockChoose = async file => {
    const full = path.join(SAMPLES, file);
    const b64 = fs.readFileSync(full).toString('base64');
    const size = fs.statSync(full).size;
    const sandbox = await mp.evaluate((name, data) => new Promise((resolve, reject) => {
      const p = wx.env.USER_DATA_PATH + '/' + name;
      wx.getFileSystemManager().writeFile({ filePath: p, data, encoding: 'base64', success: () => resolve(p), fail: e => reject(new Error(e.errMsg)) });
    }), file, b64);
    return mp.mockWxMethod('chooseImage', { tempFilePaths: [sandbox], tempFiles: [{ path: sandbox, size }] });
  };

  try {
    let page = await cur();
    log('start', { page: page.path });
    if (page.path === 'pages/recipes/index') {
      await mp.navigateTo('/pages/imports/status?id=fba67f84bca49d663484031d0ca5fd36');
      page = await waitPage('pages/imports/status');
    }
    if (page.path !== 'pages/imports/status') throw new Error('expected status page, got ' + page.path);
    await waitData('已保存到家庭菜谱', 30000, 'succeeded label');
    await shot('09-job-succeeded');
    await call('af');
    page = await waitPage('pages/recipes/detail');
    await sleep(2500);
    await shot('10-recipe-detail');
    const detailData = await dataStr();
    log('recipe-detail', { hasTitle: detailData.includes('土豆炖牛腩'), data: detailData.slice(0, 2600) });

    await mp.navigateBack();
    page = await waitPage('pages/imports/status');
    await call('30');
    page = await waitPage('pages/imports/submit');
    await sleep(1000);
    await call('60');
    await sleep(400);
    await mockChoose('recipe-dish-only.jpg');
    await call('c6');
    await waitData('图片已通过审核', 180000, 'dish review ready');
    await shot('11-dish-review-ready');
    await call('94');
    page = await waitPage('pages/imports/status');
    const failedJobId = page.query && page.query.id;
    await waitData('导入失败', 480000, 'job failed');
    await shot('12-job-failed');
    const failedData = await dataStr();
    log('job-failed', { jobId: failedJobId, data: failedData.slice(0, 900) });
    summary.failedJobId = failedJobId;
    console.log('SUMMARY', JSON.stringify(summary));
  } catch (error) {
    await shot('99-error').catch(() => {});
    console.log('FLOW_ERROR', error.message);
    console.log('SUMMARY', JSON.stringify(summary));
    process.exitCode = 1;
  } finally {
    await mp.disconnect();
  }
})();