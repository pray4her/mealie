// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createApp, defineComponent, h as vnode, watch } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { PlanEntry, RecipeInput } from 'home-contracts';
import { provideAppClient } from '../../src/shared/app-client';
import { createPlanningController } from '../../src/features/planning/use-planning';
import type { PlanAddDraft } from '../../src/features/planning/use-planning';
import { usePlanningPage } from '../../src/features/planning/use-planning-page';
import { createHarness } from '../support/harness';
import { createMemoryStorage, deferCall } from '../support/sdk-transport';
import { mountPage } from '../support/uni-stubs';
import { AppError } from '../../src/shared/errors';
import { createProductionClient as reviewClient } from '../../review/app-client';

const fields = { date: '2026-12-31', meal: 'dinner' as const, targetServings: null };
const recipeInput: RecipeInput = { title: '汤', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '盐', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] };
let guardedPage!: ReturnType<typeof usePlanningPage>; let loadGuardedPage: () => Promise<void>;
const GuardPage = defineComponent({ setup() { guardedPage = usePlanningPage(() => loadGuardedPage()); return () => vnode('div', guardedPage.confirmed.value ? 'visible' : 'hidden'); } });
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const family = await client.family.create({ requestId: 'planning-family-01', name: '家' });
  const scope = { familyId: family.familyId, generation: family.generation };
  const recipe = await client.recipes.create({ ...scope, requestId: 'planning-recipe-01', recipe: recipeInput });
  const storage = createMemoryStorage(); let seq = 0;
  const app = provideAppClient(createApp(() => null), client, { storage, newRequestId: async () => `planning-write-${++seq}` });
  await app.family.load();
  const p = createPlanningController({ api: client.planning, recipes: client.recipes, media: client.media, auth: app.auth, family: app.family,
    storage, newRequestId: async () => `planning-write-${++seq}`, now: () => Date.UTC(2026, 11, 30, 17) });
  cleanups.push(() => { p.dispose(); app.planning.dispose(); app.recipes.dispose(); app.media.dispose(); app.imports.dispose(); app.family.dispose(); app.invitations.dispose(); app.membership.dispose(); });
  return { h, client, app, p, storage, scope, recipe, draft: { ...fields, recipeId: recipe.id } };
}
test('app wires planning, Beijing date survives hide and current get/list project writes', async () => {
  const { app, p, draft } = await setup(); expect(app.planning).toBeDefined(); expect(p.selectedDate.value).toBe('2026-12-31');
  p.selectDate('2027-01-01'); p.clear(); expect(p.items.value).toEqual([]); p.activate(); expect(p.selectedDate.value).toBe('2027-01-01');
  p.selectDate(fields.date); const ack = await p.add(draft);
  expect(ack).toMatchObject({ kind: 'add' }); expect(p.confirmed.value).toEqual(ack); expect(p.pending.value).toBeNull();
  expect(p.entry.value).toMatchObject({ id: ack.id, version: 1, titleSnapshot: '汤' }); expect(p.items.value).toHaveLength(1);
  await p.update({ ...fields, id: ack.id, version: 1, targetServings: 2 }); expect(p.entry.value?.version).toBe(2);
  await p.remove({ id: ack.id, version: 2 }); expect(p.entry.value).toBeNull(); expect(p.items.value).toEqual([]); expect(p.readError.value).toBeNull();
});
test.each(['add', 'update', 'remove'] as const)('%s double clicks single flight; different new operation blocked', async kind => {
  const { p, draft, client, h } = await setup(); const created = kind === 'add' ? null : await p.add(draft);
  const gate = deferCall(); const api = { ...client.planning };
  const sends = {
    add: vi.spyOn(client.planning, 'add').mockImplementation(async input => { await gate.promise; return api.add(input); }),
    update: vi.spyOn(client.planning, 'update').mockImplementation(async input => { await gate.promise; return api.update(input); }),
    remove: vi.spyOn(client.planning, 'remove').mockImplementation(async input => { await gate.promise; return api.remove(input); }),
  }; const send = sends[kind];
  const run = () => kind === 'add' ? p.add(draft) : kind === 'update' ? p.update({ ...fields, id: created!.id, version: 1 }) : p.remove({ id: created!.id, version: 1 });
  const first = run(); const second = run(); await flushPromises();
  await expect(p.add({ ...draft, meal: 'lunch' })).rejects.toMatchObject({ code: 'CONFLICT' });
  gate.resolve(null); expect(await first).toEqual(await second); expect(send).toHaveBeenCalledTimes(1);
  expect(await h.rows('meal_plans')).toHaveLength(kind === 'remove' ? 0 : 1);
});
test('storage failure sends nothing and does not create pending', async () => {
  const { p, draft, storage, h } = await setup(); vi.spyOn(storage, 'set').mockImplementation(() => { throw new Error('full'); });
  await expect(p.add(draft)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(p.pending.value).toBeNull(); expect(await h.rows('meal_plans')).toEqual([]);
});
test('committed timeout restores exact request and reads latest instead of historic receipt', async () => {
  const { p, draft, client, storage, scope, h } = await setup(); const add = client.planning.add.bind(client.planning);
  const send = vi.spyOn(client.planning, 'add').mockImplementationOnce(async input => { await add(input); throw new AppError('UNAVAILABLE'); });
  await expect(p.add(draft)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); const original = JSON.parse(JSON.stringify(p.pending.value));
  await expect(p.add(draft)).rejects.toMatchObject({ code: 'CONFLICT' });
  const row = (await client.planning.list({ from: fields.date, to: fields.date })).items[0];
  await client.planning.update({ ...scope, ...fields, id: row.id, version: 1, targetServings: 4, requestId: 'planning-other-01' });
  p.clear(); p.activate(); expect(p.restore()).toEqual(original); const ack = await p.retry();
  expect(ack.id).toBe(row.id); expect(p.entry.value).toMatchObject({ version: 2, targetServings: 4 });
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]); expect(storage.get('home.planning.pending.v1:alice')).toBeUndefined(); expect(await h.rows('meal_plans')).toHaveLength(1);
});
test('real hide/show revalidation preserves durable intent and every intermediate draft scope/date', async () => {
  const { client, app, storage, scope, draft, h } = await setup(); vi.stubGlobal('uni', { reLaunch: vi.fn(), switchTab: vi.fn() });
  loadGuardedPage = async () => {}; const mounted = mountPage(GuardPage, { client, controllers: app }); const page = guardedPage; const p = page.planning;
  cleanups.push(() => mounted.wrapper.unmount()); await mounted.show();
  const expectedScope = JSON.stringify({ uid: 'alice', ...scope }); const key = 'home.planning.pending.v1:alice';
  const input: PlanAddDraft = { ...draft, date: '2027-02-01', meal: 'lunch', targetServings: 3.5 }; let form: PlanAddDraft | null = { ...input };
  p.selectDate(input.date); await p.selectRecipe(draft.recipeId); await p.search('汤');
  const scopeChanges: (string | null)[] = []; const dateChanges: string[] = [];
  cleanups.push(watch(page.draftScope, value => { scopeChanges.push(value); form = null; }, { flush: 'sync' }));
  cleanups.push(watch(p.selectedDate, value => { dateChanges.push(value); }, { flush: 'sync' }));
  const add = client.planning.add.bind(client.planning);
  const send = vi.spyOn(client.planning, 'add').mockImplementationOnce(async value => { await add(value); throw new AppError('UNAVAILABLE'); });
  await expect(p.add(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const original = { kind: 'add', input: { ...input, ...scope, requestId: 'planning-write-1' } };
  expect(storage.get(key)).toEqual(original); await mounted.hide();
  expect(page.confirmed.value).toBe(false); expect(p.pending.value).toBeNull(); expect(p.selectedRecipe.value).toBeNull(); expect(p.searchItems.value).toEqual([]);
  const identityGate = deferCall(); const familyGate = deferCall(); const session = client.account.session.bind(client.account); const current = client.family.current.bind(client.family);
  vi.spyOn(client.account, 'session').mockImplementationOnce(async () => { await identityGate.promise; return session(); });
  vi.spyOn(client.family, 'current').mockImplementationOnce(async () => { await familyGate.promise; return current(); });
  const showing = mounted.show(); await flushPromises();
  expect(app.auth.phase.value).toBe('checking'); expect(page.confirmed.value).toBe(false);
  expect(scopeChanges).toEqual([]); expect(dateChanges).toEqual([]); expect(storage.get(key)).toEqual(original);
  expect(() => p.activate()).toThrow(); expect(() => p.restore()).toThrow(); expect(p.pending.value).toBeNull();
  identityGate.resolve(null); await flushPromises();
  expect(app.auth.phase.value).toBe('authenticated'); expect(app.family.phase.value).toBe('checking'); expect(app.family.view.value).toBeNull();
  expect(page.confirmed.value).toBe(false); expect(scopeChanges).toEqual([]); expect(dateChanges).toEqual([]); expect(storage.get(key)).toEqual(original);
  familyGate.resolve(null); await showing;
  expect(page.confirmed.value).toBe(true); expect(page.draftScope.value).toBe(expectedScope); expect(scopeChanges).toEqual([]); expect(dateChanges).toEqual([]);
  expect(form).toEqual(input); expect(p.selectedDate.value).toBe(input.date); expect(p.restore()).toEqual(original);
  await expect(p.add(input)).rejects.toMatchObject({ code: 'CONFLICT' }); const ack = await p.retry();
  expect(ack.requestId).toBe('planning-write-1'); expect(send.mock.calls.map(([value]) => value)).toEqual([original.input, original.input]);
  expect(storage.get(key)).toBeUndefined(); expect(await h.rows('meal_plans')).toHaveLength(1); expect(p.items.value).toMatchObject([{ id: ack.id, ...input }]);
});
test.each(['clear', 'unavailable', 'no-family'] as const)('real family %s only forgets intent and draft/date for confirmed absence', async transition => {
  const { app, p, client, draft, storage } = await setup(); const key = 'home.planning.pending.v1:alice';
  p.selectDate('2027-02-01'); const draftScope = p.draftScope.value;
  vi.spyOn(client.planning, 'add').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  await expect(p.add(draft)).rejects.toThrow(); const original = storage.get(key);
  if (transition === 'clear') app.family.clear();
  else if (transition === 'unavailable') { vi.spyOn(client.family, 'current').mockRejectedValueOnce(new AppError('UNAVAILABLE')); await expect(app.family.load()).rejects.toThrow(); }
  else { vi.spyOn(client.family, 'current').mockResolvedValueOnce(null); await app.family.load(); }
  expect(p.pending.value).toBeNull(); expect(p.confirmed.value).toBeNull(); expect(() => p.restore()).toThrow();
  expect(p.draftScope.value).toBe(transition === 'no-family' ? null : draftScope);
  expect(p.selectedDate.value).toBe(transition === 'no-family' ? '2026-12-31' : '2027-02-01');
  expect(storage.get(key)).toEqual(transition === 'no-family' ? undefined : original);
});
test('ack followed by failed refresh stays confirmed, cannot retry add as uncommitted', async () => {
  const { p, draft, client, h } = await setup(); vi.spyOn(client.planning, 'get').mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  const ack = await p.add(draft); expect(p.confirmed.value).toEqual(ack); expect(p.readError.value).toBe('UNAVAILABLE'); expect(p.pending.value).toBeNull();
  await expect(p.retry()).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(await h.rows('meal_plans')).toHaveLength(1);
});
test('recovery after another member removes row confirms without recreating it', async () => {
  const { p, draft, client, scope, h } = await setup(); const add = client.planning.add.bind(client.planning);
  vi.spyOn(client.planning, 'add').mockImplementationOnce(async input => { await add(input); throw new AppError('UNAVAILABLE'); });
  await expect(p.add(draft)).rejects.toThrow(); const row = (await client.planning.list({ from: fields.date, to: fields.date })).items[0];
  await client.planning.remove({ ...scope, id: row.id, version: 1, requestId: 'planning-other-01' });
  expect((await p.retry()).id).toBe(row.id); expect(p.entry.value).toBeNull(); expect(p.readError.value).toBe('NOT_FOUND'); expect(await h.rows('meal_plans')).toEqual([]);
});
test.each(['CONFLICT', 'INVALID_INPUT', 'NOT_FOUND', 'UNAVAILABLE', 'QUOTA_EXCEEDED'] as const)('write error %s preserves only uncertain intents', async code => {
  const { p, draft, client } = await setup(); vi.spyOn(client.planning, 'add').mockRejectedValueOnce(new AppError(code));
  await expect(p.add(draft)).rejects.toMatchObject({ code }); expect(p.pending.value !== null).toBe(['UNAVAILABLE', 'QUOTA_EXCEEDED'].includes(code));
});
test('restoration validates payload and rejects old family/generation records', async () => {
  const { p, storage, draft, scope } = await setup(); const key = 'home.planning.pending.v1:alice';
  storage.set(key, { kind: 'add', input: { ...draft, ...scope, generation: 'old', requestId: 'planning-saved-01' } }); expect(p.restore()).toBeNull(); expect(storage.get(key)).toBeUndefined();
  storage.set(key, { kind: 'add', input: { ...draft, ...scope, requestId: 'planning-saved-01', titleSnapshot: 'forged' } });
  expect(() => p.restore()).toThrow(); expect(p.pending.value).toBeNull();
});
test.each(['ack', 'AUTH_REQUIRED', 'CONFLICT'] as const)('same-scope reentry detaches delayed %s without losing the original retry flight', async outcome => {
  const { p, app, draft, client, h, storage, scope } = await setup(); const oldGate = deferCall(); const retryGate = deferCall(); const add = client.planning.add.bind(client.planning);
  const send = vi.spyOn(client.planning, 'add')
    .mockImplementationOnce(async input => { const row = await add(input); await oldGate.promise; if (outcome !== 'ack') throw new AppError(outcome); return row; })
    .mockImplementationOnce(async input => { await retryGate.promise; return add(input); });
  const old = p.add(draft); const oldResult = old.catch(error => error); await flushPromises();
  const original = { kind: 'add', input: { ...draft, ...scope, requestId: 'planning-write-1' } }; const key = 'home.planning.pending.v1:alice';
  p.clear(); await app.family.load(); p.activate(); expect(p.restore()).toEqual(original);
  const retry = p.retry(); const duplicate = p.retry(); await flushPromises();
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toEqual(original.input);
  expect(p.writing.value).toBe(true); await expect(p.add(draft)).rejects.toMatchObject({ code: 'CONFLICT' });
  oldGate.resolve(null); expect(await oldResult).toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect(p.writing.value).toBe(true); expect(p.pending.value).toEqual(original); expect(storage.get(key)).toEqual(original);
  expect(p.confirmed.value).toBeNull(); expect(p.entry.value).toBeNull(); expect(app.auth.phase.value).toBe('authenticated');
  retryGate.resolve(null); const ack = await retry; expect(await duplicate).toEqual(ack); expect(ack.requestId).toBe(original.input.requestId);
  expect(p.writing.value).toBe(false); expect(p.confirmed.value).toEqual(ack); expect(storage.get(key)).toBeUndefined();
  expect(await h.rows('meal_plans')).toHaveLength(1); expect(send).toHaveBeenCalledTimes(2);
});
test.each(['hide/get', 'hide/list', 'family/get', 'family/list'] as const)('%s detaches an acknowledged refresh and cannot return its stale ack or block the new write', async scenario => {
  const { p, app, draft, client, h, storage } = await setup(); const refreshGate = deferCall(); const writeGate = deferCall();
  if (scenario.endsWith('/get')) {
    const get = client.planning.get.bind(client.planning);
    vi.spyOn(client.planning, 'get').mockImplementationOnce(async id => { const row = await get(id); await refreshGate.promise; return row; });
  } else {
    const list = client.planning.list.bind(client.planning);
    vi.spyOn(client.planning, 'list').mockImplementationOnce(async input => { const page = await list(input); await refreshGate.promise; return page; });
  }
  const old = p.add(draft); const oldResult = old.catch(error => error); await flushPromises();
  const oldAck = p.confirmed.value!; expect(oldAck.kind).toBe('add'); expect(storage.get('home.planning.pending.v1:alice')).toBeUndefined();
  let input: PlanAddDraft = { ...draft, meal: 'lunch', targetServings: 4 };
  if (scenario.startsWith('hide/')) p.clear();
  else {
    await h.database.transaction(tx => tx.remove('family_members', 'alice'));
    const view = await client.family.create({ requestId: 'planning-new-family', name: '新家' });
    const recipe = await client.recipes.create({ familyId: view.familyId, generation: view.generation, requestId: 'planning-new-recipe', recipe: recipeInput });
    input = { ...input, recipeId: recipe.id };
  }
  await app.family.load(); p.activate(); expect(p.restore()).toBeNull();
  expect(p.confirmed.value).toEqual(scenario.startsWith('hide/') ? oldAck : null);
  const retried = p.retry().catch(error => error);
  const add = client.planning.add.bind(client.planning);
  const send = vi.spyOn(client.planning, 'add').mockImplementationOnce(async value => { await writeGate.promise; return add(value); });
  const fresh = p.add(input); const freshResult = fresh.catch(error => error); await flushPromises();
  refreshGate.resolve(null);
  expect(await retried).toMatchObject({ code: 'INVALID_INPUT' }); expect(await oldResult).toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect(send).toHaveBeenCalledTimes(1); expect(p.writing.value).toBe(true); expect(p.confirmed.value).toBeNull(); expect(p.entry.value).toBeNull();
  expect(p.pending.value).toEqual({ kind: 'add', input: send.mock.calls[0][0] }); expect(storage.get('home.planning.pending.v1:alice')).toEqual(p.pending.value);
  const duplicate = p.add(input); await flushPromises(); expect(send).toHaveBeenCalledTimes(1);
  writeGate.resolve(null); const ack = await freshResult; expect(await duplicate).toEqual(ack);
  expect(ack).toMatchObject({ kind: 'add', requestId: send.mock.calls[0][0].requestId }); expect(ack.requestId).not.toBe(oldAck.requestId);
  expect(p.confirmed.value).toEqual(ack); expect(p.writing.value).toBe(false); expect(p.pending.value).toBeNull(); expect(storage.get('home.planning.pending.v1:alice')).toBeUndefined();
  expect(p.entry.value).toMatchObject({ id: ack.id, familyId: app.family.view.value!.familyId, ...input }); expect(await h.rows('meal_plans')).toHaveLength(2);
});
test('hidden write cannot repopulate state or acknowledge; explicit retry recovers the original request', async () => {
  const { p, draft, client, h } = await setup(); const gate = deferCall(); const add = client.planning.add.bind(client.planning);
  const send = vi.spyOn(client.planning, 'add').mockImplementationOnce(async input => { const row = await add(input); await gate.promise; return row; });
  const flight = p.add(draft); const failure = expect(flight).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' }); await flushPromises(); p.clear();
  await expect(p.add(draft)).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' }); expect(p.pending.value).toBeNull();
  gate.resolve(null); await failure; expect(p.entry.value).toBeNull(); expect(p.confirmed.value).toBeNull();
  p.activate(); p.restore(); await p.retry(); expect(send).toHaveBeenCalledTimes(2); expect(await h.rows('meal_plans')).toHaveLength(1);
});
test.each(['account', 'family', 'generation'] as const)('%s change clears scope/date/pending and rejects delayed results', async change => {
  const { p, app, draft, client, storage, scope } = await setup(); const gate = deferCall(); const add = client.planning.add.bind(client.planning);
  vi.spyOn(client.planning, 'add').mockImplementationOnce(async input => { const row = await add(input); await gate.promise; return row; });
  p.selectDate('2027-02-01'); const flight = p.add(draft); const failure = expect(flight).rejects.toThrow(); await flushPromises();
  if (change === 'account') { vi.spyOn(client.account, 'session').mockResolvedValue({ uid: 'bob' }); vi.spyOn(client.family, 'current').mockResolvedValue({ uid: 'bob', ...scope, role: 'member', name: '家' }); }
  else vi.spyOn(client.family, 'current').mockResolvedValue({ uid: 'alice', ...scope, [change === 'family' ? 'familyId' : 'generation']: 'changed', role: 'member', name: '家' });
  await app.family.load(); expect(p.writing.value).toBe(false); await expect(p.retry()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  gate.resolve(null); await failure;
  expect(p.entry.value).toBeNull(); expect(p.pending.value).toBeNull(); expect(p.selectedDate.value).toBe('2026-12-31'); expect(storage.get('home.planning.pending.v1:alice')).toBeUndefined();
});
test('date switches drop late queries; pagination deduplicates and refresh resets', async () => {
  const { p, draft, client } = await setup(); const ack = await p.add(draft); const row = (await client.planning.get(ack.id)); const gate = deferCall();
  vi.spyOn(client.planning, 'list').mockImplementationOnce(async () => { await gate.promise; return { items: [row], nextCursor: 'old' }; });
  const old = p.list(); await flushPromises(); p.selectDate('2027-01-01'); await p.list(); gate.resolve(null); await old; expect(p.items.value).toEqual([]);
  p.selectDate(fields.date); const send = vi.spyOn(client.planning, 'list').mockResolvedValueOnce({ items: [row], nextCursor: 'next' }).mockResolvedValueOnce({ items: [row], nextCursor: null });
  await p.list(); await Promise.all([p.list(true), p.list(true)]); expect(p.items.value).toHaveLength(1); expect(p.nextCursor.value).toBeNull();
  await p.list(); expect(send.mock.calls.at(-1)?.[0].cursor).toBeUndefined();
});
test('detail race and wrong-family responses never become current', async () => {
  const { p, draft, client } = await setup(); const a = await p.add(draft); const b = await p.add(draft); const gate = deferCall(); const get = client.planning.get.bind(client.planning);
  vi.spyOn(client.planning, 'get').mockImplementationOnce(async id => { const row = await get(id); await gate.promise; return row; });
  const old = p.get(a.id); await p.get(b.id); gate.resolve(null); await old; expect(p.entry.value?.id).toBe(b.id);
  vi.spyOn(client.planning, 'list').mockResolvedValueOnce({ items: [{ ...(await get(a.id)), familyId: 'other' }], nextCursor: null });
  await expect(p.list()).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(p.items.value).toEqual([]);
});
test('picker search/select races are isolated from global recipe filters and hidden results', async () => {
  const { p, app, recipe, client } = await setup(); const gate = deferCall();
  app.recipes.setFilters({ query: 'global', tag: '', favoritesOnly: true });
  vi.spyOn(client.recipes, 'list').mockImplementationOnce(async () => { await gate.promise; return { items: [recipe], nextCursor: null }; });
  const old = p.search('汤'); await flushPromises(); await p.search('missing'); gate.resolve(null); await old; expect(p.searchItems.value).toEqual([]); expect(app.recipes.filters.value.query).toBe('global');
  await p.selectRecipe(recipe.id); expect(p.selectedRecipe.value?.id).toBe(recipe.id); p.clear(); expect(p.selectedRecipe.value).toBeNull(); expect(p.searchItems.value).toEqual([]);
});
test('covers use one current image per plan, at most 20; ordinary failure is text fallback but auth hides all', async () => {
  const { p, draft, client, app } = await setup(); const ack = await p.add(draft); const row = (await client.planning.get(ack.id));
  const mediaId = 'c'.repeat(32); const rows: PlanEntry[] = Array.from({ length: 21 }, (_, i) => ({ ...row, id: i.toString(16).padStart(32, 'd'), coverImageId: mediaId }));
  const read = vi.spyOn(client.media, 'read').mockImplementation(async input => ({ mediaId: input.mediaId, url: 'https://private.invalid/image', expiresAt: Date.now() + 10000 }));
  await p.loadCovers(rows); expect(Object.keys(p.coverUrls.value)).toHaveLength(20); expect(read).toHaveBeenCalledTimes(20);
  read.mockRejectedValueOnce(new AppError('UNAVAILABLE')); await p.loadCovers([rows[0]]); expect(p.coverUrls.value).toEqual({});
  read.mockRejectedValueOnce(new AppError('AUTH_REQUIRED')); await expect(p.loadCovers([rows[0]])).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  expect(p.items.value).toEqual([]); expect(p.coverUrls.value).toEqual({}); expect(app.auth.phase.value).toBe('anonymous');
});
test('source disappearance preserves immutable snapshot and clears cover', async () => {
  const { p, draft, client, h, recipe, scope } = await setup(); const ack = await p.add(draft);
  await client.recipes.update({ ...scope, id: recipe.id, version: 1, requestId: 'planning-source-01', recipe: { ...recipeInput, title: '新版' } });
  await p.get(ack.id); expect(p.entry.value?.titleSnapshot).toBe('汤');
  await h.database.transaction(tx => tx.remove('recipes', recipe.id)); await p.get(ack.id);
  expect(p.entry.value).toMatchObject({ titleSnapshot: '汤', sourceAvailable: false, coverImageId: null });
});
test('page guard revalidates hide/show; scope keeps same-family draft, read failure still allows retry', async () => {
  const { client } = await setup(); vi.stubGlobal('uni', { reLaunch: vi.fn(), switchTab: vi.fn() });
  let loads = 0; loadGuardedPage = async () => { loads++; if (loads === 1) throw new AppError('UNAVAILABLE'); };
  const mounted = mountPage(GuardPage, { client }); const page = guardedPage; cleanups.push(() => mounted.wrapper.unmount());
  await mounted.show(); expect(page.confirmed.value).toBe(true); expect(page.message.value).not.toBe(''); const scope = page.draftScope.value;
  let calls = 0; await page.act(async isCurrent => { if (isCurrent()) calls++; }); expect(calls).toBe(1);
  await mounted.hide(); await page.act(async () => { calls++; }); expect(calls).toBe(1); expect(page.confirmed.value).toBe(false);
  await mounted.show(); expect(page.draftScope.value).toBe(scope); expect(page.confirmed.value).toBe(true);
  await mounted.controllers.auth.signOut(); expect(page.draftScope.value).toBeNull(); expect(page.confirmed.value).toBe(false);
});
test('review fixture supports actual planning CAS and immutable replay receipts', async () => {
  vi.stubGlobal('uni', { getStorageSync: () => ({}) }); const client = reviewClient(); const view = (await client.family.current())!;
  const input = { ...fields, familyId: view.familyId, generation: view.generation, requestId: 'review-planning-01', recipeId: '0'.repeat(31) + '1' };
  const row = await client.planning.add(input); await client.planning.update({ ...fields, familyId: view.familyId, generation: view.generation, id: row.id, version: 1, requestId: 'review-planning-02', targetServings: 3 });
  expect((await client.planning.add(input)).version).toBe(1); expect((await client.planning.get(row.id)).version).toBe(2);
  await expect(client.planning.add({ ...input, meal: 'lunch' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(client.planning.remove({ familyId: view.familyId, generation: view.generation, id: row.id, version: 1, requestId: 'review-planning-03' })).rejects.toMatchObject({ code: 'CONFLICT' });
  const removal = { familyId: view.familyId, generation: view.generation, id: row.id, version: 2, requestId: 'review-planning-04' };
  await client.planning.remove(removal); await client.planning.remove(removal); expect((await client.planning.list({ from: fields.date, to: fields.date })).items).toEqual([]);
});
test('page reconciles family revocation even when controller has already concealed its scope', async () => {
  const { client, recipe } = await setup(); const navigation: string[] = [];
  vi.stubGlobal('uni', { reLaunch: ({ url }: { url: string }) => navigation.push(url), switchTab: vi.fn() });
  loadGuardedPage = async () => {}; const mounted = mountPage(GuardPage, { client }); const page = guardedPage;
  cleanups.push(() => mounted.wrapper.unmount()); await mounted.show();
  vi.spyOn(client.planning, 'add').mockRejectedValueOnce(new AppError('FAMILY_REQUIRED')); vi.spyOn(client.family, 'current').mockResolvedValueOnce(null);
  await page.act(async () => page.planning.add({ ...fields, recipeId: recipe.id }));
  expect(page.confirmed.value).toBe(false); expect(navigation).toContain('/pages/family/onboarding'); expect(page.message.value).not.toBe('');
});
test('acknowledged save cannot return a stale ack but still reconciles family revoked during refresh', async () => {
  const { client, recipe, h } = await setup(); const navigation: string[] = [];
  vi.stubGlobal('uni', { reLaunch: ({ url }: { url: string }) => navigation.push(url), switchTab: vi.fn() }); loadGuardedPage = async () => {};
  const mounted = mountPage(GuardPage, { client }); const page = guardedPage; cleanups.push(() => mounted.wrapper.unmount()); await mounted.show();
  vi.spyOn(client.planning, 'get').mockRejectedValueOnce(new AppError('FAMILY_REQUIRED')); vi.spyOn(client.family, 'current').mockResolvedValueOnce(null);
  let acknowledged = false;
  await page.act(async () => { const ack = await page.planning.add({ ...fields, recipeId: recipe.id }); acknowledged = ack.kind === 'add'; });
  expect(acknowledged).toBe(false); expect(await h.rows('meal_plans')).toHaveLength(1); expect(page.confirmed.value).toBe(false);
  expect(navigation).toContain('/pages/family/onboarding');
});
test('native-picker action token stays stale after hide/show and late identity cannot authorize hidden page', async () => {
  const { client } = await setup(); vi.stubGlobal('uni', { reLaunch: vi.fn(), switchTab: vi.fn() }); loadGuardedPage = async () => {};
  const mounted = mountPage(GuardPage, { client }); const page = guardedPage; cleanups.push(() => mounted.wrapper.unmount()); await mounted.show();
  const gate = deferCall(); let applied = false;
  const action = page.act(async isCurrent => { await gate.promise; if (isCurrent()) applied = true; });
  await mounted.hide(); await mounted.show(); gate.resolve(null); await action; expect(applied).toBe(false);
  const identity = deferCall(); vi.spyOn(client.account, 'session').mockImplementationOnce(async () => { await identity.promise; return { uid: 'alice' }; });
  const showing = mounted.show(); await flushPromises(); await mounted.hide(); identity.resolve(null); await showing;
  expect(page.confirmed.value).toBe(false); expect(page.planning.items.value).toEqual([]);
});
test('cold controller restores remove timeout, retry double clicks send one identical request', async () => {
  const { p, app, draft, client, storage, h } = await setup(); const ack = await p.add(draft); const remove = client.planning.remove.bind(client.planning);
  const send = vi.spyOn(client.planning, 'remove').mockImplementationOnce(async input => { await remove(input); throw new AppError('UNAVAILABLE'); });
  await expect(p.remove({ id: ack.id, version: 1 })).rejects.toThrow(); p.dispose();
  app.planning.activate(); app.planning.restore(); const saved = storage.get('home.planning.pending.v1:alice'); expect(saved).toMatchObject({ kind: 'remove' });
  const results = await Promise.all([app.planning.retry(), app.planning.retry()]); expect(results[0]).toEqual(results[1]);
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]); expect(await h.rows('meal_plans')).toEqual([]);
});
test('acknowledgement survives storage cleanup failure and does not enable a second add', async () => {
  const { p, draft, storage, h } = await setup(); vi.spyOn(storage, 'remove').mockImplementation(() => { throw new Error('storage offline'); });
  const ack = await p.add(draft); expect(p.confirmed.value).toEqual(ack); expect(p.pending.value).toBeNull();
  await expect(p.add(draft)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(p.confirmed.value).toEqual(ack); expect(await h.rows('meal_plans')).toHaveLength(1);
});
test('latest refresh supersedes list snapshot started before acknowledged update', async () => {
  const { p, draft, client } = await setup(); const ack = await p.add(draft); const gate = deferCall(); const list = client.planning.list.bind(client.planning);
  vi.spyOn(client.planning, 'list').mockImplementationOnce(async input => { const page = await list(input); await gate.promise; return page; });
  const old = p.list(); await flushPromises(); await p.update({ ...fields, id: ack.id, version: 1, targetServings: 5 }); gate.resolve(null); await old;
  expect(p.items.value).toMatchObject([{ version: 2, targetServings: 5 }]);
});
test('late cover and selection responses after conceal cannot restore protected values', async () => {
  const { p, draft, client, recipe } = await setup(); const ack = await p.add(draft); const row = (await client.planning.get(ack.id)); const gate = deferCall();
  vi.spyOn(client.media, 'read').mockImplementationOnce(async input => { await gate.promise; return { mediaId: input.mediaId, url: 'https://private.invalid/image', expiresAt: Date.now() + 10000 }; });
  vi.spyOn(client.recipes, 'get').mockImplementationOnce(async () => { await gate.promise; return recipe; });
  const cover = p.loadCovers([{ ...row, coverImageId: 'c'.repeat(32) }]); const selection = p.selectRecipe(recipe.id);
  p.clear(); gate.resolve(null); await Promise.all([cover, selection]); expect(p.coverUrls.value).toEqual({}); expect(p.selectedRecipe.value).toBeNull();
});
test('detail refresh invalidates an earlier cover link when source becomes unavailable', async () => {
  const { p, draft, client, h, recipe } = await setup(); const ack = await p.add(draft); const row = await client.planning.get(ack.id); const gate = deferCall();
  vi.spyOn(client.media, 'read').mockImplementationOnce(async input => { await gate.promise; return { mediaId: input.mediaId, url: 'https://private.invalid/old', expiresAt: Date.now() + 10000 }; });
  const cover = p.loadCovers([{ ...row, coverImageId: 'c'.repeat(32) }]);
  await h.database.transaction(tx => tx.remove('recipes', recipe.id)); await p.get(ack.id); gate.resolve(null); await cover;
  expect(p.entry.value?.sourceAvailable).toBe(false); expect(p.coverUrls.value).toEqual({});
});
test('search continuation deduplicates, resets cursor with changed query and rejects foreign selections', async () => {
  const { p, recipe, client } = await setup();
  const list = vi.spyOn(client.recipes, 'list').mockResolvedValueOnce({ items: [recipe], nextCursor: 'next' }).mockResolvedValueOnce({ items: [recipe], nextCursor: null });
  await p.search('汤'); await Promise.all([p.search('汤', true), p.search('汤', true)]); expect(p.searchItems.value).toHaveLength(1); expect(list).toHaveBeenCalledTimes(2);
  await p.search('other'); expect(p.searchItems.value).toEqual([]); expect(list.mock.calls[2][0].cursor).toBeUndefined();
  vi.spyOn(client.recipes, 'get').mockResolvedValueOnce({ ...recipe, familyId: 'other' }); await expect(p.selectRecipe(recipe.id)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(p.selectedRecipe.value).toBeNull();
});
test('signout deletes uncertain payload and stale auth errors cannot sign out a new identity', async () => {
  const { p, draft, client, app, storage } = await setup(); const gate = deferCall();
  vi.spyOn(client.planning, 'add').mockImplementationOnce(async () => { await gate.promise; throw new AppError('AUTH_REQUIRED'); });
  const writing = p.add(draft); const rejected = expect(writing).rejects.toThrow(); await flushPromises();
  await app.auth.signOut(); expect(storage.get('home.planning.pending.v1:alice')).toBeUndefined();
  vi.spyOn(client.account, 'session').mockResolvedValue({ uid: 'bob' }); vi.spyOn(client.family, 'current').mockResolvedValue({ uid: 'bob', familyId: 'new', generation: 'new', role: 'member', name: '家' });
  await app.family.load(); gate.resolve(null); await rejected; expect(app.auth.identity.value?.uid).toBe('bob'); expect(app.auth.phase.value).toBe('authenticated'); expect(p.pending.value).toBeNull();
});
