/* global getApp */
// Real SDK/real test-space checks. No identity fixtures or mocked cloud/network methods.
const fs = require('node:fs'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
process.env.WECHAT_DEVTOOLS_CLI ||= 'D:/微信web开发者工具/cli.bat';
const { createSession } = require('./task11-automator.cjs');
const project = path.resolve(process.env.FLOW_PROJECT || 'dist/build/mp-weixin'); const out = path.resolve('ops/task12-real');
const results = process.env.FLOW_ACTIONS && fs.existsSync(path.join(out, 'flow-results.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'flow-results.json'), 'utf8')) : { ticket: 12, kind: 'real WeChat account + real alipay test space in developer-tool simulator', physicalDevice: false, steps: [] };
results.pass = false;
(async () => {
  const s = await createSession({ project, port: process.env.AUTO_PORT || '9520', base: path.join(project, 'pages'), out });
  const { mp } = s;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', "$p = Get-Process | Where-Object { $_.Path -eq 'D:\\微信web开发者工具\\微信开发者工具.exe' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }"], { windowsHide: true });
  await mp.currentPage();
  const run = action => mp.evaluate(async action => {
    const root = getApp(); const provides = root.$vm?.$?.appContext?.provides;
    const app = provides && Reflect.ownKeys(provides).map(key => provides[key]).find(value => value?.shopping && value?.auth && value?.family && value?.client);
    if (!app) return { pass: false, error: 'APP_CONTROLLER_NOT_FOUND', appKeys: Object.keys(root).filter(key => !/token/i.test(key)) };
    try {
      if (action === 'login') {
        await app.auth.restore(); await app.auth.signIn();
        await app.family.load(); const family = app.family.view.value;
        if (!family) return { pass: false, error: 'FAMILY_REQUIRED' };
        root.__task12Real = { scope: { familyId: family.familyId, generation: family.generation }, seq: 0, prefix: 'task12-real-' + Date.now() };
        return { pass: true, authenticated: true, hasFamily: true };
      }
      const state = root.__task12Real; if (!state) return { pass: false, error: 'MISSING_REAL_CONTEXT' };
      const api = app.client.shopping; const mutation = () => ({ ...state.scope, requestId: state.prefix + '-' + (++state.seq) });
      if (action === 'create') {
        const first = await api.createList({ ...mutation(), name: 'Issue12 验收清单' }); state.listId = first.id;
        const second = await api.createList({ ...mutation(), name: 'Issue12 临时删除验收' }); state.secondId = second.id;
        const raw = await api.addItem({ ...mutation(), listId: first.id, item: { raw: '葱适量', name: null, quantity: null, unit: null, note: null } }); state.rawId = raw.id;
        const known = await api.addItem({ ...mutation(), listId: first.id, item: { raw: '鸡蛋6个', name: '鸡蛋', quantity: 6, unit: '个', note: 'CLI真实云验收' } }); state.knownId = known.id;
        const rows = await api.listItems({ listId: first.id }); if (rows.items.length !== 2) throw { code: 'WRONG_ITEM_COUNT' };
        return { pass: true, listId: first.id, rawItemId: raw.id, knownItemId: known.id, knownQuantity: rows.items.find(row => row.id === known.id).quantity, rawQuantity: rows.items.find(row => row.id === raw.id).quantity };
      }
      if (action === 'concurrent') {
        const commands = [state.rawId, state.knownId].map(id => ({ ...mutation(), listId: state.listId, id, version: 1, checked: true }));
        const outcomes = await Promise.allSettled(commands.map(input => api.setChecked(input))); const firstAttempt = outcomes.map(row => row.status === 'fulfilled' ? 'success' : row.reason?.code || row.reason?.errCode || 'UNAVAILABLE');
        for (let i = 0; i < outcomes.length; i++) if (outcomes[i].status !== 'fulfilled') await api.setChecked(commands[i]);
        state.originalCheck = commands[0]; const rows = await api.listItems({ listId: state.listId });
        if (!rows.items.every(row => row.checked && row.version === 2)) throw { code: 'CONCURRENT_RESULT_LOST' };
        return { pass: true, firstAttempt, recoveredWithOriginalRequest: firstAttempt.some(value => value !== 'success'), versions: rows.items.map(row => row.version), checked: rows.items.map(row => row.checked), boundary: 'same real account, simultaneous SDK calls; not two distinct members' };
      }
      if (action === 'replay-conflict') {
        await api.setChecked(state.originalCheck);
        await api.setChecked({ ...mutation(), listId: state.listId, id: state.rawId, version: 2, checked: false });
        await api.setChecked(state.originalCheck); let conflict = false;
        try { await api.updateItem({ ...mutation(), listId: state.listId, id: state.rawId, version: 1, item: { raw: '旧版本不得覆盖', name: null, quantity: null, unit: null, note: null } }); } catch (error) { conflict = error.code === 'CONFLICT'; }
        const row = await api.getItem({ listId: state.listId, id: state.rawId }); if (!conflict || row.checked || row.version !== 3 || row.raw !== '葱适量') throw { code: 'REPLAY_OR_VERSION_FAILED' };
        return { pass: true, staleEditConflict: conflict, replayDidNotFlip: true, rawPreserved: true, version: row.version };
      }
      if (action === 'rename-delete') {
        await api.renameList({ ...mutation(), id: state.listId, version: 1, name: 'Issue12 验收清单（已验证）' });
        const deletion = { ...mutation(), id: state.secondId, version: 1 }; await api.removeList(deletion); await api.removeList(deletion);
        let inaccessible = false; try { await api.getList(state.secondId); } catch (error) { inaccessible = error.code === 'NOT_FOUND'; }
        const list = await api.getList(state.listId); if (!inaccessible || list.version !== 2) throw { code: 'DELETE_OR_RENAME_FAILED' };
        return { pass: true, renamedVersion: list.version, deletedListInaccessible: true, repeatedDeleteAcknowledged: true };
      }
      if (action === 'readback') {
        const row = await api.getItem({ listId: state.listId, id: state.rawId }); const known = await api.getItem({ listId: state.listId, id: state.knownId });
        if (row.checked || !known.checked || row.quantity !== null || known.quantity !== 6) throw { code: 'PERSISTED_STATE_FAILED' };
        return { pass: true, listId: state.listId, rawVersion: row.version, rawChecked: row.checked, knownChecked: known.checked, rawQuantity: row.quantity, knownQuantity: known.quantity };
      }
      if (action === 'item-lifecycle') {
        const added = await api.addItem({ ...mutation(), listId: state.listId, item: { raw: '临时验收条目', name: null, quantity: null, unit: null, note: null } });
        await api.updateItem({ ...mutation(), listId: state.listId, id: added.id, version: 1, item: { raw: '临时验收条目已修改', name: '临时条目', quantity: 0.5, unit: '斤', note: '编辑后删除' } });
        const row = await api.getItem({ listId: state.listId, id: added.id }); if (row.quantity !== 0.5 || row.version !== 2) throw { code: 'ITEM_EDIT_FAILED' };
        const deletion = { ...mutation(), listId: state.listId, id: added.id, version: 2 }; await api.removeItem(deletion); await api.removeItem(deletion);
        let inaccessible = false; try { await api.getItem({ listId: state.listId, id: added.id }); } catch (error) { inaccessible = error.code === 'NOT_FOUND'; }
        if (!inaccessible) throw { code: 'ITEM_DELETE_FAILED' };
        return { pass: true, editedQuantity: row.quantity, editedVersion: row.version, deletedItemInaccessible: true, repeatedDeleteAcknowledged: true };
      }
      if (action === 'parent-delete') {
        const list = await api.createList({ ...mutation(), name: 'Issue12 父清单删除验收' });
        const item = await api.addItem({ ...mutation(), listId: list.id, item: { raw: '随父清单停止访问', name: null, quantity: null, unit: null, note: null } });
        await api.removeList({ ...mutation(), id: list.id, version: 1 });
        const errors = [];
        for (const read of [() => api.listItems({ listId: list.id }), () => api.getItem({ listId: list.id, id: item.id })]) { try { await read(); errors.push('ACCESSIBLE'); } catch (error) { errors.push(error.code); } }
        if (errors.some(code => code !== 'NOT_FOUND')) throw { code: 'DELETED_PARENT_ACCESSIBLE' };
        return { pass: true, listItemsError: errors[0], getItemError: errors[1], physicalCleanup: 'deferred to #18' };
      }
      return { pass: false, error: 'UNKNOWN_TEST_ACTION' };
    } catch (error) { return { pass: false, error: error?.code || error?.errCode || 'UNAVAILABLE' }; }
  }, action);
  for (const action of (process.env.FLOW_ACTIONS || 'login,create,concurrent,replay-conflict,rename-delete,readback,item-lifecycle,parent-delete').split(',')) {
    const result = await run(action); results.steps.push({ action, ...result }); console.log('REAL', action, JSON.stringify(result));
    fs.writeFileSync(path.join(out, 'flow-results.json'), JSON.stringify(results, null, 2)); if (!result.pass) throw new Error(action + ': ' + result.error);
  }
  await mp.reLaunch('/pages/shopping/index'); await s.until(() => s.includes('Issue12'), 30000, 'shopping reentry'); await mp.screenshot({ path: path.join(out, 'shopping-reentry.png') });
  results.pass = true; results.note = 'Only own marked lists were created; the empty temporary list was deleted; the verified list remains for physical-device acceptance.';
  fs.writeFileSync(path.join(out, 'flow-results.json'), JSON.stringify(results, null, 2)); await mp.disconnect();
})().catch(error => { results.pass = false; results.error = String(error.message || error); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'flow-results.json'), JSON.stringify(results, null, 2)); console.error(results.error); process.exit(1); });
