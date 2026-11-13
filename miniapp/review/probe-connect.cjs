const automator = require('miniprogram-automator');
const fs = require('fs');
(async () => {
  let mini;
  for (let i = 0; i < 20; i++) {
    try { mini = await automator.connect({ wsEndpoint: 'ws://localhost:9422' }); break; }
    catch (e) { await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!mini) { console.log('CONNECT_FAILED: port 9422 not ready'); process.exit(2); }
  try {
    const page = await mini.currentPage();
    console.log('currentPage: ' + (page ? page.path : 'none'));
    const sys = await mini.systemInfo();
    console.log('platform=' + sys.platform + ' version=' + sys.version + ' SDKVersion=' + sys.SDKVersion + ' windowWidth=' + sys.windowWidth);
    const stack = await mini.pageStack();
    console.log('pageStack: ' + stack.map(p => p.path).join(' -> '));
    await mini.screenshot({ path: 'dist/task09-samples/state-current.png' });
    console.log('screenshot saved: dist/task09-samples/state-current.png');
  } catch (e) { console.log('PROBE_ERROR: ' + e.message); }
  finally { await mini.disconnect(); }
})();