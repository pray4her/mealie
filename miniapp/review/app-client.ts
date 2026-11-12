import type { AppClient, FamilyView, JobView, MediaView, Recipe } from 'home-contracts';
import { AppError } from '../src/shared/errors';

// This module is aliased only by --mode ui-review; it never contacts a cloud object.
export const reviewMarker = 'HOME_UI_REVIEW_V11_ONLY';
const key = 'home.ui-review.v11';
type Scenario = { auth?: 'anonymous' | 'failure'; family?: 'missing' | 'failure' | 'member' | 'forbidden'; recipes?: 'empty' | 'failure' | 'conflict' | 'long'; media?: 'failure'; job?: JobView['state']; delay?: number };
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
  function get(id: string) { const row = rows.find(r => r.id === id); if (!row) throw new AppError('NOT_FOUND'); return row; }
  const image = (mediaId: string): MediaView => ({ mediaId, state: 'ready', uploadExpiresAt: now + 86400000, review: 'disabled', retryable: false });
  const job = () => { const state = scenario().job || currentJob.state; return { ...currentJob, state, attempts: state === 'queued' ? 0 : 1, recipeId: state === 'succeeded' ? rows[0].id : null, error: state === 'failed' ? 'PROVIDER_UNAVAILABLE' as const : null }; };
  return {
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
