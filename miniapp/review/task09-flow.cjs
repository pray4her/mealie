const automator = require('miniprogram-automator');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(__dirname, '../ops/task09-real-2026-11-14');
const SAMPLES = path.resolve(__dirname, '../dist/task09-samples');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// Compiled WXML event ids (review/extract-handlers.cjs); invoking them runs the
// same guarded handlers a tap runs. Automator element selectors cannot cross
// virtualHost components in this IDE version.
const H = {
  login: { signIn: '34' },
  onboarding: { create: 'd5', nameInput: 'ac' },
  index: { add: '00', import: '86' },
  submit: { methodImage: '60', choose: 'c6', submit: '94' },
  status: { open: 'af', new: '30' },
};

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
    // simulator FS cannot read PC paths; stage the real sample into the sandbox
    const sandbox = await mp.evaluate((name, data) => new Promise((resolve, reject) => {
      const p = wx.env.USER_DATA_PATH + '/' + name;
      wx.getFileSystemManager().writeFile({ filePath: p, data, encoding: 'base64', success: () => resolve(p), fail: e => reject(new Error(e.errMsg)) });
    }), file, b64);
    return mp.mockWxMethod('chooseImage', { tempFilePaths: [sandbox], tempFiles: [{ path: sandbox, size }] });
  };

  try {
    let page = await cur();
    log('start', { page: page.path });
    if (!['pages/account/login', 'pages/family/onboarding', 'pages/recipes/index'].includes(page.path)) {
      await mp.reLaunch('/pages/recipes/index');
      page = await waitPage('pages/recipes/index', 30000);
    }
    await shot('01-login');

    if (page.path === 'pages/account/login') {
      await until(async () => {
        const p = await cur();
        if (p.path !== 'pages/account/login') return true;
        await call(H.login.signIn);
        await sleep(3000);
        return false;
      }, 60000, 'login');
      page = await cur();
      log('after-login', { page: page.path });
    }

    if (page.path === 'pages/family/onboarding') {
      await shot('02-onboarding');
      await call(H.onboarding.nameInput, { value: '验收家庭' });
      await sleep(500);
      await call(H.onboarding.create);
      page = await waitPage('pages/recipes/index', 45000);
      log('family-created', { page: page.path });
    }

    page = await waitPage('pages/recipes/index', 45000);
    await sleep(2000);
    await shot('03-home');
    await call(H.index.add);
    await sleep(800);
    await shot('04-add-sheet');
    await call(H.index.import);
    page = await waitPage('pages/imports/submit');
    await sleep(1500);

    // oversized client-side rejection (real validation, no upload)
    await mockChoose('recipe-oversized.png');
    await call(H.submit.methodImage);
    await sleep(500);
    await call(H.submit.choose);
    const oversizeMsg = await waitData('请选择一张不超过 1 MiB', 20000, 'oversize error');
    log('oversize-rejected', { message: oversizeMsg });
    await shot('05-oversize-rejected');

    // success path: real upload + real WeChat async review + real vision
    await mockChoose('recipe-success.jpg');
    await call(H.submit.choose);
    await waitData('等待审核', 60000, 'review pending');
    log('review-pending', {});
    await shot('06-review-pending');
    await waitData('图片已通过审核', 180000, 'review ready');
    log('review-ready', {});
    await shot('07-review-ready');
    await call(H.submit.submit);
    page = await waitPage('pages/imports/status');
    const successJobId = page.query && page.query.id;
    await sleep(3000);
    await shot('08-job-running');
    log('job-submitted', { jobId: successJobId });
    await waitData('打开已保存菜谱', 300000, 'job succeeded');
    await shot('09-job-succeeded');
    log('job-succeeded', { jobId: successJobId });
    await call(H.status.open);
    page = await waitPage('pages/recipes/detail');
    await sleep(2500);
    await shot('10-recipe-detail');
    const detailData = await dataStr();
    log('recipe-detail', { hasTitle: detailData.includes('土豆炖牛腩'), data: detailData.slice(0, 1500) });
    summary.successJobId = successJobId;

    // non-recipe path: real upload + review, vision must fail clearly
    await mp.navigateBack();
    page = await waitPage('pages/imports/status');
    await call(H.status.new);
    page = await waitPage('pages/imports/submit');
    await sleep(1000);
    await call(H.submit.methodImage);
    await sleep(400);
    await mockChoose('recipe-dish-only.jpg');
    await call(H.submit.choose);
    await waitData('图片已通过审核', 180000, 'dish review ready');
    await shot('11-dish-review-ready');
    await call(H.submit.submit);
    page = await waitPage('pages/imports/status');
    const failedJobId = page.query && page.query.id;
    await waitData('导入失败', 300000, 'job failed');
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