import type { AppClient, FamilyView, JobView, MediaView, Recipe, PlanEntry, ShoppingList, ShoppingItem, ShoppingIntent } from 'home-contracts';
import { parseIntent as parseShoppingIntent } from '../src/features/shopping/validation';
import { beijingToday, parseLocalDate } from '../src/features/planning/dates';
import { parsePlanIntent, parsePlanList } from '../src/features/planning/validation';
import { validId } from '../src/features/recipes/validation';
import { AppError } from '../src/shared/errors';

// This module is aliased only by --mode ui-review; it never contacts a cloud object.
export const reviewMarker = 'HOME_UI_REVIEW_V11_ONLY';
const key = 'home.ui-review.v11';
type PlanningScenario = { seed?: 'empty' | 'populated' | 'long' | 'pagination'; date?: string; read?: 'failure'; write?: 'failure' | 'lost-ack' | 'conflict'; source?: 'unavailable' };
type ShoppingScenario = { seed?: 'empty' | 'list-only' | 'populated' | 'long' | 'pagination' | 'checked'; read?: 'failure'; write?: 'failure' | 'lost-ack' | 'conflict' };
type Scenario = { shopping?: ShoppingScenario; planning?: PlanningScenario; auth?: 'anonymous' | 'failure'; family?: 'missing' | 'failure' | 'member' | 'forbidden'; recipes?: 'empty' | 'failure' | 'conflict' | 'long'; media?: 'failure'; job?: JobView['state']; delay?: number };
const scenario = (): Scenario => uni.getStorageSync(key) || {};
const family: FamilyView = { uid: 'ui-review-owner', familyId: 'ui-review-family', generation: 'ui-review-generation', role: 'owner', name: '林家的厨房' };
const now = Date.UTC(2026, 10, 10, 19);
const names = ['noodles', 'chicken', 'rice', 'salad'];
const titles = ['鲜虾溏心蛋汤面', '柠檬香煎鸡胸肉', '柠香鲜虾焖饭', '牛油果缤纷沙拉'];
const authors = ['阿林', '小满', '爸爸', '妈妈'];
export const reviewRecipes: Recipe[] = titles.map((title, i) => ({
  id: (i + 1).toString(16).padStart(32, '0'), familyId: family.familyId, createdBy: family.uid, title,
  description: '汤鲜、面暖，一家人都喜欢的简单一餐。', baseServings: 2, prepMinutes: 5, cookMinutes: [15, 20, 30, 10][i],
  ingredients: [{ raw: '鲜虾 6只', name: '鲜虾', quantity: 6, unit: '只', note: null }, { raw: '面条 200克', name: '面条', quantity: 200, unit: '克', note: null }, { raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }],
  steps: ['煮面，捞入碗中。', '加入鲜虾、鸡蛋和热汤，煮熟后调味。'], tags: ['家常', '快手菜'],
  version: 1, createdAt: now - i * 60000, updatedAt: now, imageIds: [(i + 11).toString(16).padStart(32, '0')],
  source: { kind: 'manual', url: null, importJobId: null, warnings: [] }, authorLabel: authors[i], isFavorite: false,
}));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function createProductionClient(): AppClient {
  const rows = clone(reviewRecipes); let signedIn = true; let currentFamily = true;
  let currentJob: JobView = { id: 'f'.repeat(32), state: 'queued', attempts: 0, recipeId: null, createdAt: now, updatedAt: now, error: null };
  const view = (): FamilyView => ({ ...family, role: scenario().family === 'member' ? 'member' : 'owner' });
  async function pause() { const delay = scenario().delay; if (delay) await new Promise(resolve => setTimeout(resolve, delay)); }
  async function authorize() { await pause(); if (!signedIn || scenario().auth === 'anonymous') throw new AppError('AUTH_REQUIRED'); if (scenario().family === 'forbidden') throw new AppError('FORBIDDEN'); }
  function get(id: string) { const row = rows.find(r => r.id === id); if (!row || scenario().planning?.source === 'unavailable') throw new AppError('NOT_FOUND'); return row; }
  const plans = new Map<string, PlanEntry>(); let planSequence = 0; let cursorSequence = 0;
  const competingEdits = new Set<string>();
  const receipts = new Map<string, { payload: string; result: PlanEntry | null }>();
  const cursors = new Map<string, { from: string; to: string; date: string; createdAt: number; id: string }>();
  let seeded: string | null = null;
  // Seed only this review client's memory, lazily on first planning access: the devtools simulator wipes
  // storage across a restart, so a scenario written after boot must still take effect.
  // Pending intents are created by real UI writes, never seeded.
  // The signature covers the whole scenario, not just the seed name: a write-driven scene leaves rows
  // behind, so returning to the same seed name must still reset (one client per scenario, as the tests do).
  function ensureSeed() {
    const current = scenario();
    const signature = JSON.stringify(current);
    if (seeded === signature) return;
    seeded = signature;
    const seed = current.planning;
    const name = seed?.seed ?? 'empty';
    plans.clear(); competingEdits.clear(); receipts.clear(); cursors.clear(); planSequence = 0; cursorSequence = 0;
    if (!seed || name === 'empty') return;
    const date = parseLocalDate(seed.date ?? beijingToday(Date.now()));
    const meals = ['breakfast', 'lunch', 'dinner', 'other'] as const;
    for (let i = 0; i < (name === 'pagination' ? 21 : 4); i++) {
      const source = rows[i % rows.length]; const id = (++planSequence).toString(16).padStart(32, 'a');
      plans.set(id, { id, familyId: family.familyId, createdBy: family.uid, recipeId: source.id,
        titleSnapshot: source.title + (name === 'long' ? '，一家人周末认真准备的暖心家常菜，搭配新鲜时蔬和香浓汤汁，慢慢品尝这顿温暖又美味、充满心意的晚餐' : ''),
        date, meal: name === 'pagination' ? 'dinner' : meals[i % 4], targetServings: i % 2 ? 2.5 : null,
        version: 1, createdAt: now + planSequence, updatedAt: now + planSequence, sourceAvailable: true, coverImageId: source.imageIds[0] ?? null });
    }
  }
  function planningRead() { if (scenario().planning?.read === 'failure') throw new AppError('UNAVAILABLE'); }
  async function planningAccess() { await authorize(); if (!currentFamily || scenario().family === 'missing') throw new AppError('FAMILY_REQUIRED'); ensureSeed(); }
  function plan(id: string) { const row = plans.get(validId(id)); if (!row) throw new AppError('NOT_FOUND'); return row; }
  function project(row: PlanEntry): PlanEntry {
    const source = scenario().planning?.source === 'unavailable' ? undefined : rows.find(recipe => recipe.id === row.recipeId && recipe.familyId === row.familyId);
    return clone({ ...row, sourceAvailable: !!source, coverImageId: source?.imageIds[0] ?? null });
  }
  async function planningWrite(kind: 'add' | 'update' | 'remove', value: unknown): Promise<PlanEntry | null> {
    const intent = parsePlanIntent({ kind, input: value }); const input = intent.input;
    await planningAccess();
    if (input.familyId !== family.familyId || input.generation !== family.generation) throw new AppError('FAMILY_REQUIRED');
    const key = kind + ':' + input.requestId; const payload = JSON.stringify(intent); const receipt = receipts.get(key);
    if (receipt) { if (receipt.payload !== payload) throw new AppError('CONFLICT'); return clone(receipt.result); }
    if (scenario().planning?.write === 'failure') throw new AppError('UNAVAILABLE');
    if (scenario().planning?.write === 'conflict' && intent.kind !== 'add' && !competingEdits.has(intent.input.id)) {
      const row = plan(intent.input.id); competingEdits.add(row.id);
      plans.set(row.id, { ...row, version: row.version + 1, targetServings: 3.5, updatedAt: row.updatedAt + 1 });
    }
    let result: PlanEntry | null;
    if (intent.kind === 'add') {
      const source = get(intent.input.recipeId); const id = (++planSequence).toString(16).padStart(32, 'a');
      result = { id, familyId: family.familyId, createdBy: family.uid, recipeId: source.id, titleSnapshot: source.title,
        date: intent.input.date, meal: intent.input.meal, targetServings: intent.input.targetServings, version: 1, createdAt: now + planSequence, updatedAt: now + planSequence,
        sourceAvailable: true, coverImageId: source.imageIds[0] ?? null }; plans.set(id, result);
    } else {
      const row = plan(intent.input.id); if (row.version !== intent.input.version) throw new AppError('CONFLICT');
      if (intent.kind === 'remove') { plans.delete(row.id); result = null; }
      else { result = { ...row, date: intent.input.date, meal: intent.input.meal, targetServings: intent.input.targetServings, version: row.version + 1, updatedAt: row.updatedAt + 1 }; plans.set(row.id, result); }
    }
    const snapshot = result ? project(result) : null; receipts.set(key, { payload, result: clone(snapshot) });
    if (scenario().planning?.write === 'lost-ack') throw new AppError('UNAVAILABLE');
    return clone(snapshot);
  }
  const image = (mediaId: string): MediaView => ({ mediaId, state: 'ready', uploadExpiresAt: now + 86400000, review: 'disabled', retryable: false });
  const shoppingLists = new Map<string, ShoppingList>(); const shoppingItems = new Map<string, ShoppingItem>();
  const shoppingReceipts = new Map<string, { payload: string; id: string }>(); const shoppingConflicts = new Set<string>();
  let shoppingSeed = ''; let shoppingSequence = 0;
  async function shoppingAccess(read = true) {
    await authorize(); if (!currentFamily || scenario().family === 'missing') throw new AppError('FAMILY_REQUIRED');
    const seed = scenario().shopping?.seed ?? 'empty';
    if (seed !== shoppingSeed) {
      shoppingSeed = seed; shoppingLists.clear(); shoppingItems.clear(); shoppingReceipts.clear(); shoppingConflicts.clear(); shoppingSequence = 0;
      if (seed !== 'empty') {
        for (let i = 0; i < 2; i++) { const id = (i + 1).toString(16).padStart(32, 'c'); shoppingLists.set(id, { id, familyId: family.familyId, name: i ? '周末采购' : '这周的采购单', createdBy: family.uid, version: 1, createdAt: now + i, updatedAt: now + i }); }
        for (let i = 0; seed !== 'list-only' && i < (seed === 'pagination' ? 23 : 4); i++) {
          const id = (++shoppingSequence).toString(16).padStart(32, 'd'); const raw = ['鲜虾', '鸡蛋', '面条', '葱适量'][i % 4] + (seed === 'long' ? '，周末全家一起做饭，请挑选新鲜的食材并按当天需要的数量购买，原文和备注需要完整保留' : '');
          shoppingItems.set(id, { id, familyId: family.familyId, listId: '1'.padStart(32, 'c'), raw, name: null, quantity: i % 2 ? null : i + 1, unit: i % 2 ? null : '份', note: seed === 'long' ? '数量不确定时，保留原文并和家人核对。' : null,
            checked: seed === 'checked' || i === 1, createdBy: family.uid, version: 1, createdAt: now + i, updatedAt: now + i });
        }
      }
    }
    if (read && scenario().shopping?.read === 'failure') throw new AppError('UNAVAILABLE');
  }
  function shoppingList(id: string) { const row = shoppingLists.get(validId(id)); if (!row) throw new AppError('NOT_FOUND'); return row; }
  function shoppingItem(listId: string, id: string) { shoppingList(listId); const row = shoppingItems.get(validId(id)); if (!row || row.listId !== listId) throw new AppError('NOT_FOUND'); return row; }
  async function shoppingWrite(kind: ShoppingIntent['kind'], input: unknown) {
    const command = parseShoppingIntent({ kind, input }); await shoppingAccess(false);
    if (command.input.familyId !== family.familyId || command.input.generation !== family.generation) throw new AppError('CONFLICT');
    const key = kind + ':' + command.input.requestId; const payload = JSON.stringify(command); const previous = shoppingReceipts.get(key);
    if (previous) { if (previous.payload !== payload) throw new AppError('CONFLICT'); return { id: previous.id }; }
    if (scenario().shopping?.write === 'failure') throw new AppError('UNAVAILABLE');
    const value = command.input; const target = 'listId' in value ? 'id' in value ? shoppingItem(value.listId, value.id) : shoppingList(value.listId) : 'id' in value ? shoppingList(value.id) : null;
    if ('version' in value && target) {
      if (scenario().shopping?.write === 'conflict' && !shoppingConflicts.has(target.id)) { target.version++; shoppingConflicts.add(target.id); }
      if (target.version !== value.version) throw new AppError('CONFLICT');
    }
    const id = 'id' in value ? value.id : (++shoppingSequence).toString(16).padStart(32, kind === 'createList' ? 'c' : 'd');
    const base = { id, familyId: family.familyId, createdBy: family.uid, version: 1, createdAt: now + shoppingSequence, updatedAt: now + shoppingSequence };
    switch (command.kind) {
      case 'createList': shoppingLists.set(id, { ...base, name: command.input.name }); break;
      case 'renameList': shoppingLists.set(id, { ...shoppingList(id), name: command.input.name, version: command.input.version + 1 }); break;
      case 'removeList': shoppingLists.delete(id); break;
      case 'addItem': shoppingItems.set(id, { ...base, ...command.input.item, listId: command.input.listId, checked: false }); break;
      case 'removeItem': shoppingItems.delete(id); break;
      case 'updateItem': shoppingItems.set(id, { ...shoppingItem(command.input.listId, id), ...command.input.item, version: command.input.version + 1 }); break;
      case 'setChecked': shoppingItems.set(id, { ...shoppingItem(command.input.listId, id), checked: command.input.checked, version: command.input.version + 1 }); break;
    }
    shoppingReceipts.set(key, { payload, id }); if (scenario().shopping?.write === 'lost-ack') throw new AppError('UNAVAILABLE'); return { id };
  }
  function shoppingPage<T>(rows: T[], input: { cursor?: string; limit?: number }) { const at = Number(input.cursor ?? 0); const limit = input.limit ?? 20; return { items: clone(rows.slice(at, at + limit)), nextCursor: rows.length > at + limit ? String(at + limit) : null }; }
  const job = () => { const state = scenario().job || currentJob.state; return { ...currentJob, state, attempts: state === 'queued' ? 0 : 1, recipeId: state === 'succeeded' ? rows[0].id : null, error: state === 'failed' ? 'PROVIDER_UNAVAILABLE' as const : null }; };
  return {
    shopping: {
      async listLists(input) { await shoppingAccess(); return shoppingPage([...shoppingLists.values()], input); }, async getList(id) { await shoppingAccess(); return clone(shoppingList(id)); },
      async listItems(input) { await shoppingAccess(); shoppingList(input.listId); return shoppingPage([...shoppingItems.values()].filter(row => row.listId === input.listId), input); },
      async getItem(input) { await shoppingAccess(); return clone(shoppingItem(input.listId, input.id)); },
      createList: input => shoppingWrite('createList', input), renameList: input => shoppingWrite('renameList', input), removeList: input => shoppingWrite('removeList', input),
      addItem: input => shoppingWrite('addItem', input), updateItem: input => shoppingWrite('updateItem', input), removeItem: input => shoppingWrite('removeItem', input), setChecked: input => shoppingWrite('setChecked', input),
    },
    account: {
      async session() { await pause(); if (!signedIn || scenario().auth === 'anonymous') throw new AppError('AUTH_REQUIRED'); if (scenario().auth === 'failure') throw new AppError('UNAVAILABLE'); return { uid: family.uid }; },
      async signInWeixin() { signedIn = true; if (scenario().auth === 'failure') throw new AppError('UNAVAILABLE'); return { uid: family.uid }; },
      async signOut() { signedIn = false; },
    },
    family: {
      async current() { await authorize(); if (scenario().family === 'failure') throw new AppError('UNAVAILABLE'); return currentFamily && scenario().family !== 'missing' ? view() : null; },
      async create(input) { await authorize(); currentFamily = true; return { ...view(), name: input.name }; },
      async join() { await authorize(); currentFamily = true; return { ...view(), role: 'member' }; },
      async invite() { await authorize(); return { invitationId: 'ui-review-invite', token: 'ui-review-invitation-token', expiresAt: now + 86400000 }; },
      async revokeInvite() { await authorize(); },
      async invitations() { await authorize(); return { items: [{ invitationId: 'ui-review-invite', createdAt: now, expiresAt: now + 86400000, status: 'pending' }, { invitationId: 'ui-review-used', createdAt: now - 86400000, expiresAt: now, status: 'used' }] }; },
      async members() { await authorize(); return [{ uid: family.uid, nickname: '阿林', role: view().role, generation: family.generation }, { uid: 'ui-review-member-8F26', nickname: '小满', role: 'member', generation: 'member-1' }, { uid: 'ui-review-member-1C08', nickname: '爸爸', role: 'member', generation: 'member-2' }]; },
      async leave() { await authorize(); currentFamily = false; },
      async removeMember() { await authorize(); },
      async transferOwner() { await authorize(); return { ...view(), role: 'member' }; },
    },
    recipes: {
      async list(input) { await authorize(); if (scenario().recipes === 'failure') throw new AppError('UNAVAILABLE'); const all = scenario().recipes === 'empty' ? [] : rows.filter(r => (!input.query || r.title.toLowerCase().includes(input.query.toLowerCase())) && (!input.tag || r.tags.includes(input.tag)) && (!input.favoritesOnly || r.isFavorite)); return { items: clone(all).map(r => scenario().recipes === 'long' ? { ...r, title: r.title + '，一家人的拿手菜，认真做一顿温暖的晚餐' } : r), nextCursor: null }; },
      async get(id) { await authorize(); return clone(get(id)); },
      async create(input) { await authorize(); const row = { ...rows[0], ...input.recipe, id: '9'.repeat(32), imageIds: [] }; rows.push(row); return clone(row); },
      async update(input) { await authorize(); if (scenario().recipes === 'conflict') throw new AppError('CONFLICT'); const row = get(input.id); Object.assign(row, input.recipe, { version: row.version + 1 }); return clone(row); },
      async favorite(input) { await authorize(); get(input.id).isFavorite = input.enabled; },
      async bindImages(input) { await authorize(); const row = get(input.id); row.imageIds = input.imageIds; row.version++; return clone(row); },
    },
    planning: {
      async add(input) { return (await planningWrite('add', input))!; },
      async update(input) { return (await planningWrite('update', input))!; },
      async remove(input) { await planningWrite('remove', input); },
      async get(id) { await planningAccess(); planningRead(); return project(plan(id)); },
      async list(input) {
        const query = parsePlanList(input); await planningAccess(); planningRead(); const after = query.cursor ? cursors.get(query.cursor) : undefined;
        if (query.cursor && (!after || after.from !== query.from || after.to !== query.to)) throw new AppError('INVALID_INPUT');
        const all = [...plans.values()].filter(row => row.date >= query.from && row.date <= query.to && (!after || row.date > after.date
          || row.date === after.date && (row.createdAt > after.createdAt || row.createdAt === after.createdAt && row.id > after.id)))
          .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        const page = all.slice(0, query.limit); let nextCursor: string | null = null;
        if (all.length > query.limit) { nextCursor = 'review-plan-cursor-' + ++cursorSequence; const last = page[page.length - 1]; cursors.set(nextCursor, { from: query.from, to: query.to, date: last.date, createdAt: last.createdAt, id: last.id }); }
        return { items: page.map(project), nextCursor };
      },
    },
    media: {
      async status(input) { await authorize(); if (scenario().media === 'failure') throw new AppError('UNAVAILABLE'); return input.mediaIds.map(image); },
      async read(input) { await authorize(); if (scenario().media === 'failure') throw new AppError('UNAVAILABLE'); const i = reviewRecipes.findIndex(r => r.imageIds.includes(input.mediaId)); return { mediaId: input.mediaId, url: '/static/ui-review/' + names[Math.max(0, i)] + '.jpg', expiresAt: Date.now() + 3600000 }; },
      async requestUpload() { await authorize(); return image('a'.repeat(32)); },
      async upload(input) { await authorize(); return image(input.mediaId); },
      async complete(input) { await authorize(); return image(input.mediaId); },
    },
    imports: {
      async submit() { await authorize(); return job(); },
      async get() { await authorize(); return job(); },
      async cancel() { await authorize(); currentJob = { ...currentJob, state: 'cancelled' }; return job(); },
    },
  };
}
