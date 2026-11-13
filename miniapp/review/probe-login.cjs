const automator = require('miniprogram-automator');
const path = require('node:path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9422' });
  const logs = [];
  mp.on('console', msg => logs.push({ type: msg.type, text: (msg.args || []).map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 600) }));
  try {
    const page = await mp.currentPage();
    console.log('PAGE', page.path);
    const els = await page.$$('[role="button"]');
    for (const e of els) console.log('BUTTON', JSON.stringify(await e.text()), await e.attribute('aria-label'), await e.attribute('aria-disabled'));
    const btn = els.find ? null : null;
    let target = null;
    for (const e of els) { const t = await e.text(); if (t.includes('微信登录')) { target = e; break; } }
    if (target) { await target.tap(); console.log('TAPPED'); }
    await sleep(10000);
    const now = await mp.currentPage();
    console.log('AFTER', now.path);
    const root = await now.$('.page');
    console.log('TEXT', root ? (await root.text()).slice(0, 800) : 'no root');
    await mp.screenshot({ path: path.resolve(__dirname, '../dist/task09-samples/state-login-diag.png') });
    console.log('CONSOLE', JSON.stringify(logs.slice(-50)));
  } finally { await mp.disconnect(); }
})();