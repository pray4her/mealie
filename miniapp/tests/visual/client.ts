import type { AppClient, FamilyView, JobView, MediaView, Recipe } from 'home-contracts';

// Only the dedicated visual Vite config imports this offline client.
export const fixtureIds = { recipe: 'a'.repeat(32), job: 'b'.repeat(32), media: 'c'.repeat(32), invitation: 'd'.repeat(32) };
export function createVisualClient(scenario = 'family'): AppClient {
  const now = Date.now();
  const view: FamilyView = { uid: 'visual-owner', familyId: 'visual-family', generation: 'visual-generation', role: scenario === 'member' ? 'member' : 'owner', name: '视觉验证家庭' };
  let signedIn = scenario !== 'login';
  let family = ['login', 'onboarding', 'join'].includes(scenario) ? null : view;
  const recipe: Recipe = {
    id: fixtureIds.recipe, familyId: view.familyId, createdBy: view.uid, version: 1, createdAt: now, updatedAt: now,
    title: '家常时蔬鸡肉饭', description: '仅用于离线界面验证的示例。长段落和未知数量用于检查换行及完整呈现。',
    baseServings: 2, prepMinutes: 10, cookMinutes: 20,
    ingredients: [{ raw: '鸡肉 200 克，切块', name: '鸡肉', quantity: 200, unit: '克', note: '切成均匀的小块' },
      { raw: '时令蔬菜适量，洗净备用', name: '时令蔬菜', quantity: null, unit: null, note: '按家人口味准备，保留适量的原文' }],
    steps: ['将鸡肉与蔬菜洗净，分别切好。', '热锅后加入食材，翻炒至熟。较长的步骤内容用于检查大字号和窄屏下是否自然增长，不能裁掉正文。', '盛出，与米饭一起享用。'],
    tags: ['家常', '晚餐'], imageIds: [fixtureIds.media], authorLabel: '测试家人', isFavorite: false,
    source: { kind: 'manual', url: null, importJobId: null, warnings: [] },
  };
  let job: JobView = { id: fixtureIds.job, state: scenario === 'succeeded' ? 'succeeded' : scenario === 'failed' ? 'failed' : scenario === 'cancelled' ? 'cancelled' : scenario === 'running' ? 'running' : 'queued',
    attempts: 1, recipeId: scenario === 'succeeded' ? recipe.id : null, createdAt: now, updatedAt: now, error: scenario === 'failed' ? 'INVALID_OUTPUT' : null };
  const media = (mediaId: string): MediaView => ({ mediaId, state: scenario === 'media-rejected' ? 'rejected' : scenario === 'media-pending' ? 'pending' : 'ready', uploadExpiresAt: now + 600000, review: 'mock', retryable: false });
  const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
  return {
    account: { async session() { if (!signedIn) return fail('AUTH_REQUIRED'); return { uid: view.uid }; }, async signInWeixin() { signedIn = true; return { uid: view.uid }; }, async signOut() { signedIn = false; } },
    family: {
      async current() { if (scenario === 'unavailable') return fail('UNAVAILABLE'); return family; },
      async create(input) { family = { ...view, name: input.name }; return family; }, async join() { family = view; return view; },
      async members() { return [{ uid: view.uid, nickname: '测试家人（本人）', role: view.role, generation: view.generation }, { uid: 'visual-member', nickname: '另一位家人的较长显示名称', role: 'member', generation: 'visual-member-generation' }]; },
      async invite() { return { invitationId: fixtureIds.invitation, token: 'A'.repeat(43), expiresAt: now + 86400000 }; }, async revokeInvite() {},
      async invitations() { return { items: [
        { invitationId: fixtureIds.invitation, status: 'pending', createdAt: now, expiresAt: now + 86400000 },
        { invitationId: 'e'.repeat(32), status: 'expired', createdAt: now - 86400000, expiresAt: now - 1000 },
      ] }; }, async leave() { family = null; }, async removeMember() {}, async transferOwner() { view.role = 'member'; return view; },
    },
    recipes: {
      async list(input) {
        if (scenario === 'empty' || input.query && !recipe.title.includes(input.query) || input.tag && !recipe.tags.includes(input.tag) || input.favoritesOnly && !recipe.isFavorite) return { items: [], nextCursor: null };
        return { items: [structuredCopy(recipe), { ...structuredCopy(recipe), id: 'f'.repeat(32), title: '清爽蔬菜与米饭的另一种家常做法', imageIds: [] }].filter(row => !input.favoritesOnly || row.id === recipe.id), nextCursor: null };
      }, async get() { return structuredCopy(recipe); }, async create(input) { Object.assign(recipe, input.recipe); return structuredCopy(recipe); },
      async update(input) { Object.assign(recipe, input.recipe, { version: recipe.version + 1 }); return structuredCopy(recipe); },
      async favorite(input) { recipe.isFavorite = input.enabled; }, async bindImages(input) { recipe.imageIds = input.imageIds; recipe.version++; return structuredCopy(recipe); },
    },
    media: { async status(input) { return input.mediaIds.map(media); }, async read(input) { return { mediaId: input.mediaId, url: '/static/visual-chicken.jpg', expiresAt: Date.now() + 600000 }; },
      async requestUpload() { return media(fixtureIds.media); }, async upload(input) { return media(input.mediaId); }, async complete(input) { return media(input.mediaId); } },
    imports: { async get() { return { ...job }; }, async submit() { job = { ...job, state: 'queued', recipeId: null, error: null }; return { ...job }; }, async cancel() { job = { ...job, state: 'cancelled', recipeId: null }; return { ...job }; } },
  };
}
function structuredCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
