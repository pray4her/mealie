/* global getApp */
// Two genuine SDK runtimes of the same account, using only the marked acceptance records.
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
process.env.WECHAT_DEVTOOLS_CLI ||= 'D:/微信web开发者工具/cli.bat';
const { createSession } = require('./task11-automator.cjs');
const out = path.resolve('ops/task12-real'); const flow = JSON.parse(fs.readFileSync(path.join(out, 'flow-results.json'), 'utf8'));
const records = flow.steps.find(step => step.action === 'create' && step.pass); assert(records, 'Run the genuine flow first');
const result = { ticket: 12, kind: 'two developer-tool SDK runtimes, same real account and test space', physicalDevice: false, distinctMembers: false };
(async () => {
  const sessions = [];
  try {
    for (const [project, port] of [['dist/build/mp-weixin', '9562'], ['dist/task12-session-b', '9563']]) sessions.push(await createSession({ project: path.resolve(project), port, base: path.resolve(project, 'pages'), out }));
    const run = (session, action, command) => session.mp.evaluate(async (action, command) => {
      const provides = getApp().$vm.$.appContext.provides;
      const app = Reflect.ownKeys(provides).map(key => provides[key]).find(value => value?.shopping);
      if (!app) return { pass: false, error: 'WRONG_RUNTIME' };
      try {
        if (action === 'login') { await app.auth.restore(); await app.auth.signIn(); await app.family.load(); return { pass: true, uid: app.auth.identity.value.uid, familyId: app.family.view.value.familyId, generation: app.family.view.value.generation }; }
        if (action === 'read') return { pass: true, row: await app.client.shopping.getItem(command) };
        await app.client.shopping.setChecked(command); return { pass: true };
      } catch (error) { return { pass: false, error: error.code || 'UNAVAILABLE' }; }
    }, action, command);
    const identities = [];
    for (const session of sessions) identities.push(await run(session, 'login'));
    assert(identities.every(identity => identity.pass), 'Both genuine logins must succeed');
    assert.equal(identities[0].uid, identities[1].uid); assert.equal(identities[0].familyId, identities[1].familyId);
    result.sameAccount = true; result.sameFamily = true;
    const ids = [records.rawItemId, records.knownItemId]; const stamp = 'task12-sessions-' + Date.now();
    const command = async (index, id, suffix) => {
      const read = await run(sessions[index], 'read', { listId: records.listId, id }); assert(read.pass);
      const identity = identities[index]; return { familyId: identity.familyId, generation: identity.generation, requestId: stamp + suffix, listId: records.listId, id, version: read.row.version, checked: !read.row.checked };
    };
    const commands = await Promise.all(ids.map((id, index) => command(index, id, '-' + index)));
    result.differentItems = await Promise.all(commands.map((input, index) => run(sessions[index], 'check', input)));
    for (let index = 0; index < commands.length; index++) if (!result.differentItems[index].pass) assert((await run(sessions[index], 'check', commands[index])).pass, 'Recover original request');
    result.differentItemReadback = [];
    for (const input of commands) { const read = await run(sessions[0], 'read', { listId: records.listId, id: input.id }); assert(read.pass); assert.equal(read.row.checked, input.checked); assert.equal(read.row.version, input.version + 1); result.differentItemReadback.push({ version: read.row.version, checked: read.row.checked }); }
    const shared = await command(0, ids[0], '-same-a');
    const competing = identities.map((identity, index) => ({ ...shared, generation: identity.generation, requestId: stamp + '-same-' + index }));
    result.sameItem = await Promise.all(sessions.map((session, index) => run(session, 'check', competing[index])));
    assert.equal(result.sameItem.filter(row => row.pass).length, 1);
    const loser = result.sameItem.findIndex(row => !row.pass);
    // Unknown provider failures retain the original request; its replay resolves the business conflict.
    result.sameItemRecovery = result.sameItem[loser].error === 'UNAVAILABLE' ? await run(sessions[loser], 'check', competing[loser]) : result.sameItem[loser];
    assert.equal(result.sameItemRecovery.error, 'CONFLICT');
    const final = await run(sessions[0], 'read', { listId: records.listId, id: shared.id }); assert(final.pass); assert.equal(final.row.version, shared.version + 1); assert.equal(final.row.checked, shared.checked);
    result.finalVersion = final.row.version; result.pass = true;
  } finally { for (const session of sessions) await session.mp.disconnect().catch(() => {}); }
})().catch(error => { result.pass = false; result.error = error.message; }).finally(() => { fs.writeFileSync(path.join(out, 'sessions.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); if (!result.pass) process.exit(1); });
