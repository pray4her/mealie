import { expect, test } from 'vitest';
import type { RecipeInput, RecipeMutation, RecipeUpdate } from 'home-contracts';
import { createHarness } from '../support/harness';
import { deferCall } from '../support/sdk-transport';
import { createRecipesService } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes';
import type { RecipeRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-recipes/repository';

let sequence = 0;
const requestId = () => 'recipe-request-' + String(++sequence).padStart(6, '0');
export const textRecipe = (): RecipeInput => ({ title: '盐焗鸡', description: null, baseServings: null, prepMinutes: 0, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['放入盐，蒸熟。'], tags: [] });
async function setup(options: Parameters<typeof createHarness>[0] = {}) {
  const h = createHarness(options);
  for (const uid of ['owner', 'member', 'outsider']) await h.seedIdentity({ uid });
  const owner = h.client('owner'); const member = h.client('member'); const outsider = h.client('outsider');
  const view = await owner.family.create({ requestId: requestId(), name: '我家' });
  const invite = await owner.family.invite({ requestId: requestId() });
  const joined = await member.family.join({ requestId: requestId(), token: invite.token });
  const other = await outsider.family.create({ requestId: requestId(), name: '另一家' });
  const input = (): RecipeMutation => ({ requestId: requestId(), familyId: view.familyId, generation: view.generation, recipe: textRecipe() });
  return { h, owner, member, outsider, view, joined, other, input };
}

test('creates_reads_lists_and_preserves_unknown_quantity_and_server_ownership', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  expect(recipe).toMatchObject({ title: '盐焗鸡', familyId: f.view.familyId, createdBy: 'owner', version: 1, imageIds: [], source: { kind: 'manual', url: null, importJobId: null, warnings: [] } });
  expect(recipe.ingredients[0]).toEqual({ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null });
  expect(recipe.prepMinutes).toBe(0); expect(recipe.baseServings).toBeNull();
  expect(await f.member.recipes.get(recipe.id)).toMatchObject({ id: recipe.id, title: '盐焗鸡' });
  expect(await f.member.recipes.list({})).toMatchObject({ items: [{ id: recipe.id }], nextCursor: null });
});

test('database_field_order_does_not_break_reads_or_original_request_replay', async () => {
  const f = await setup(); const input = f.input(); const created = await f.owner.recipes.create(input);
  const [row] = await f.h.rows<RecipeRecord>('recipes'); const ingredient = row.ingredients[0];
  f.h.memory.seed('recipes', row._id, { ...row, ingredients: [{ note: ingredient.note, unit: ingredient.unit,
    quantity: ingredient.quantity, name: ingredient.name, raw: ingredient.raw }] });
  await expect(f.owner.recipes.list({})).resolves.toMatchObject({ items: [created], nextCursor: null });
  await expect(f.owner.recipes.get(created.id)).resolves.toEqual(created);
  await expect(f.owner.recipes.create(input)).resolves.toEqual(created);
  expect(await f.h.rows('recipes')).toHaveLength(1);
});
test('another_member_can_edit_but_stale_versions_cannot_overwrite', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  const edit: RecipeUpdate = { requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation, id: recipe.id, version: 1, recipe: { ...textRecipe(), title: '成员修改' } };
  expect(await f.member.recipes.update(edit)).toMatchObject({ version: 2, createdBy: 'owner', title: '成员修改' });
  await expect(f.owner.recipes.update({ ...f.input(), id: recipe.id, version: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await f.owner.recipes.get(recipe.id)).title).toBe('成员修改');
});
test('foreign_and_missing_resources_are_indistinguishable_and_cannot_be_updated', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  for (const id of [recipe.id, 'f'.repeat(32)]) {
    await expect(f.outsider.recipes.get(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.outsider.recipes.update({ requestId: requestId(), familyId: f.other.familyId, generation: f.other.generation, id, version: 1, recipe: textRecipe() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }
  expect((await f.outsider.recipes.list({})).items).toEqual([]);
});
test.each(['createdBy', 'familyId', 'version', 'imageIds', 'source', 'slug'])('rejects_client_owned_recipe_field_%s', async field => {
  const f = await setup(); const input = f.input(); Object.assign(input.recipe, { [field]: 'forged' });
  await expect(f.owner.recipes.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('recipes')).toHaveLength(0);
});
test.each([
  { title: ' ' }, { title: '字'.repeat(121) }, { title: '坏\u0000字' }, { ingredients: [] }, { steps: [] },
  { baseServings: 0 }, { baseServings: '2' }, { prepMinutes: -1 }, { cookMinutes: Infinity },
  { ingredients: [{ raw: '盐适量', name: '盐', quantity: 0, unit: null, note: null }] },
  { ingredients: [{ raw: '盐适量', name: '', quantity: null, unit: null, note: null }] },
  { steps: Array.from({ length: 51 }, () => '一步') }, { tags: ['字'.repeat(41)] },
  { steps: Array.from({ length: 20 }, () => '字'.repeat(2000)) },
])('rejects_invalid_or_oversized_input_%#', async patch => {
  const f = await setup(); const input = f.input(); Object.assign(input.recipe, patch);
  await expect(f.owner.recipes.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('recipes')).toHaveLength(0);
});
test('preserves_raw_unicode_and_multiline_steps_and_optional_known_values', async () => {
  const f = await setup(); const input = f.input();
  Object.assign(input.recipe, { title: '🍲'.repeat(120), description: '说明\n第二行', baseServings: 2.5, prepMinutes: 0, cookMinutes: 30,
    ingredients: [{ raw: '  盐适量  ', name: '盐', quantity: null, unit: null, note: '最后加' }] });
  const recipe = await f.owner.recipes.create(input);
  expect(recipe.ingredients[0].raw).toBe('  盐适量  '); expect(recipe.title).toBe('🍲'.repeat(120)); expect(recipe.baseServings).toBe(2.5);
});
test.each(['rejected', 'throws'] as const)('audit_%s_never_writes_or_changes_existing_recipe', async outcome => {
  let armed = false;
  const f = await setup({ content: { async checkText() { if (armed) { if (outcome === 'throws') throw new Error('private'); return 'rejected'; } return 'allowed'; } } });
  const recipe = await f.owner.recipes.create(f.input()); armed = true;
  await expect(f.owner.recipes.create(f.input())).rejects.toMatchObject({ code: outcome === 'throws' ? 'UNAVAILABLE' : 'INVALID_INPUT' });
  await expect(f.owner.recipes.update({ ...f.input(), id: recipe.id, version: 1 })).rejects.toBeDefined();
  expect(await f.h.rows('recipes')).toHaveLength(1); expect((await f.owner.recipes.get(recipe.id)).version).toBe(1);
});
test('all_text_fields_are_audited_before_save', async () => {
  const checked: string[] = []; const f = await setup({ content: { async checkText(text) { checked.push(text); return 'allowed'; } } });
  const input = f.input(); input.recipe.description = '说明'; input.recipe.tags = ['家常']; input.recipe.ingredients[0].unit = '克'; input.recipe.ingredients[0].note = '最后加';
  await f.owner.recipes.create(input); const audit = checked.at(-1)!;
  for (const text of ['盐焗鸡', '说明', '盐适量', '盐', '克', '最后加', '蒸熟', '家常']) expect(audit).toContain(text);
});
test('same_request_replays_once_and_changed_payload_conflicts_even_after_later_edits', async () => {
  const f = await setup(); const input = f.input(); const created = await f.owner.recipes.create(input);
  expect(await f.owner.recipes.create(input)).toEqual(created);
  await expect(f.owner.recipes.create({ ...input, recipe: { ...input.recipe, title: '不同' } })).rejects.toMatchObject({ code: 'CONFLICT' });
  const edit = { ...f.input(), id: created.id, version: 1, recipe: { ...textRecipe(), title: '第二版' } };
  const updated = await f.owner.recipes.update(edit);
  expect(await f.owner.recipes.update(edit)).toEqual(updated); expect(await f.h.rows('recipes')).toHaveLength(1);
});
test('concurrent_same_version_edits_have_one_winner', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  const results = await Promise.allSettled([
    f.owner.recipes.update({ ...f.input(), id: recipe.id, version: 1, recipe: { ...textRecipe(), title: '甲' } }),
    f.member.recipes.update({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation, id: recipe.id, version: 1, recipe: { ...textRecipe(), title: '乙' } }),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
  expect((await f.owner.recipes.get(recipe.id)).version).toBe(2);
});
test('delayed_audit_cannot_save_after_member_removal_or_token_revocation', async () => {
  for (const revoke of [false, true]) {
    const wait = deferCall(); let armed = false;
    const f = await setup({ content: { async checkText() { if (armed) await wait.promise; return 'allowed'; } } }); armed = true;
    const pending = f.member.recipes.create({ ...f.input(), generation: f.joined.generation });
    await new Promise(resolve => setTimeout(resolve, 5));
    if (revoke) f.h.revokeToken('member');
    else await f.owner.family.removeMember({ requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, uid: 'member', targetGeneration: f.joined.generation });
    wait.resolve(null); await expect(pending).rejects.toMatchObject({ code: revoke ? 'AUTH_REQUIRED' : 'FAMILY_REQUIRED' });
    expect(await f.h.rows('recipes')).toHaveLength(0);
  }
});
test('old_generation_first_delivery_and_receipt_cannot_revive_after_rejoin', async () => {
  const f = await setup(); const input = { ...f.input(), generation: f.joined.generation };
  await f.member.recipes.create(input);
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  const invite = await f.owner.family.invite({ requestId: requestId() }); await f.member.family.join({ requestId: requestId(), token: invite.token });
  for (const attempt of [input, { ...input, requestId: requestId() }]) await expect(f.member.recipes.create(attempt)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await f.h.rows('recipes')).toHaveLength(1);
});
test.each(['insert:recipes', 'insert:mutation_receipts'] as const)('failure_at_%s_rolls_back_recipe_and_member_fence', async stage => {
  let hook = () => {}; const f = await setup({ content: { async checkText() { hook(); return 'allowed'; } } });
  const before = await f.h.rows('family_members'); hook = () => f.h.memory.failNext(stage);
  await expect(f.owner.recipes.create(f.input())).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await f.h.rows('recipes')).toHaveLength(0); expect(await f.h.rows('family_members')).toEqual(before);
});
test('lost_commit_ack_recovers_the_original_committed_recipe', async () => {
  let hook = () => {}; const f = await setup({ content: { async checkText() { hook(); return 'allowed'; } } });
  hook = () => f.h.memory.failNext('after-commit');
  const recipe = await f.owner.recipes.create(f.input()); expect(recipe.version).toBe(1); expect(await f.h.rows('recipes')).toHaveLength(1);
});
test('list_cursor_is_family_bound_and_same_time_recipes_page_without_duplicates', async () => {
  const f = await setup(); const created = [];
  for (let i = 0; i < 3; i++) created.push(await f.owner.recipes.create(f.input()));
  const first = await f.owner.recipes.list({ limit: 2 }); expect(first.items.map(r => r.id)).toEqual([created[2].id, created[1].id]);
  const second = await f.owner.recipes.list({ limit: 2, cursor: first.nextCursor! }); expect(second.items.map(r => r.id)).toEqual([created[0].id]); expect(second.nextCursor).toBeNull();
  await expect(f.outsider.recipes.list({ cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('member_mutation_fence_prevents_a_staged_write_from_committing_after_removal', async () => {
  let barrier: ReturnType<ReturnType<typeof createHarness>['memory']['barrierNextCommit']> | undefined;
  let armed = false;
  const f = await setup({ content: { async checkText() { if (armed) barrier = f.h.memory.barrierNextCommit(); return 'allowed'; } } });
  armed = true;
  const pending = f.member.recipes.create({ ...f.input(), generation: f.joined.generation });
  while (!barrier) await new Promise(resolve => setTimeout(resolve, 0));
  await barrier.reached;
  await f.owner.family.removeMember({ requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, uid: 'member', targetGeneration: f.joined.generation });
  barrier.release();
  await expect(pending).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' }); expect(await f.h.rows('recipes')).toHaveLength(0);
});
test('list_revalidates_membership_after_the_scoped_query_returns', async () => {
  const f = await setup(); await f.owner.recipes.create(f.input());
  const gate = deferCall(); const entered = deferCall();
  const api = createRecipesService({ database: f.h.database, now: () => 1_800_000_000_000, newId: () => 'a'.repeat(32),
    content: { async checkText() { return 'allowed'; } }, async revalidateIdentity() {},
    reads: { async list() { entered.resolve(null); await gate.promise; return (await f.h.rows<RecipeRecord>('recipes')).map(({ _id, familyId, title, tags, createdAt }) => ({ _id, familyId, title, tags, createdAt })); }, async favorites() { return []; } },
  }, f.joined);
  const pending = api.list({}); await entered.promise;
  await f.owner.family.removeMember({ requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, uid: 'member', targetGeneration: f.joined.generation });
  gate.resolve(null); await expect(pending).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
});
test('membership_changes_preserve_shared_recipes_and_anonymize_departed_author_display', async () => {
  const f = await setup(); const recipe = await f.member.recipes.create({ ...f.input(), generation: f.joined.generation });
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  expect(await f.owner.recipes.get(recipe.id)).toMatchObject({ authorLabel: '已离开成员', createdBy: 'member', title: '盐焗鸡' });
  await expect(f.member.recipes.get(recipe.id)).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
});
test.each(['replace:recipes', 'insert:mutation_receipts'] as const)('update_failure_at_%s_rolls_back_version_and_text', async stage => {
  let hook = () => {}; const f = await setup({ content: { async checkText() { hook(); return 'allowed'; } } });
  const recipe = await f.owner.recipes.create(f.input()); hook = () => f.h.memory.failNext(stage);
  await expect(f.owner.recipes.update({ ...f.input(), id: recipe.id, version: 1, recipe: { ...textRecipe(), title: '不能保存' } })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await f.owner.recipes.get(recipe.id)).toMatchObject({ version: 1, title: '盐焗鸡' });
});
test('write_quota_survives_new_service_instances_and_does_not_bypass_audit_limit', async () => {
  const f = await setup();
  for (let i = 0; i < 10; i++) await f.h.client('owner').recipes.create(f.input());
  await expect(f.h.client('owner').recipes.create(f.input())).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await f.h.rows('recipes')).toHaveLength(10);
});
test('rejected_audit_is_terminal_and_a_late_allowed_call_cannot_commit_the_same_request', async () => {
  const entered = deferCall(); const wait = deferCall(); let armed = false; let calls = 0;
  const f = await setup({ content: { async checkText() {
    if (!armed) return 'allowed';
    if (++calls === 1) { entered.resolve(null); await wait.promise; return 'allowed'; }
    return 'rejected';
  } } }); armed = true;
  const input = f.input(); const late = f.owner.recipes.create(input); const lateResult = Promise.allSettled([late]);
  await entered.promise;
  await expect(f.owner.recipes.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  wait.resolve(null);
  expect((await lateResult)[0]).toMatchObject({ status: 'rejected', reason: { code: 'INVALID_INPUT' } });
  await expect(f.owner.recipes.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('recipes')).toHaveLength(0); expect(calls).toBe(2);
});
test('a_completed_success_wins_over_a_late_audit_rejection_for_the_same_request', async () => {
  const entered = deferCall(); const wait = deferCall(); let armed = false; let calls = 0;
  const f = await setup({ content: { async checkText() {
    if (!armed) return 'allowed';
    if (++calls === 1) { entered.resolve(null); await wait.promise; return 'rejected'; }
    return 'allowed';
  } } }); armed = true;
  const input = f.input(); const late = f.owner.recipes.create(input); await entered.promise;
  const winner = await f.owner.recipes.create(input); wait.resolve(null);
  expect(await late).toEqual(winner); expect(await f.h.rows('recipes')).toHaveLength(1);
});
test('lost_rejection_commit_ack_still_returns_terminal_rejection_on_replay', async () => {
  let armed = false;
  const f = await setup({ content: { async checkText() { if (armed) { f.h.memory.failNext('after-commit'); return 'rejected'; } return 'allowed'; } } });
  armed = true; const input = f.input();
  await expect(f.owner.recipes.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(f.owner.recipes.create(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('recipes')).toHaveLength(0);
});

test('search_is_literal_case_insensitive_substring_with_exact_tag_and_and_filters', async () => {
  const f = await setup();
  for (const [title, tags] of [['香煎盐焗鸡', ['家常']], ['Chicken [Soup].*', ['Soup']], ['CHICKEN noodle', ['soup']]] as const) {
    await f.owner.recipes.create({ ...f.input(), recipe: { ...textRecipe(), title, tags: [...tags] } });
  }
  expect((await f.owner.recipes.list({ query: ' 盐焗 ' })).items.map(r => r.title)).toEqual(['香煎盐焗鸡']);
  expect((await f.owner.recipes.list({ query: 'cHiCkEn', tag: ' Soup ' })).items.map(r => r.title)).toEqual(['Chicken [Soup].*']);
  expect((await f.owner.recipes.list({ query: '.*' })).items.map(r => r.title)).toEqual(['Chicken [Soup].*']);
  expect((await f.owner.recipes.list({ tag: '家' })).items).toEqual([]);
  expect((await f.owner.recipes.list({ query: '  ', tag: '' })).items).toHaveLength(3);
});

test.each([{ query: 1 }, { query: '字'.repeat(121) }, { tag: '字'.repeat(41) }, { query: '\u0000' }, { tag: '\uD800' },
  { favoritesOnly: 'true' }, { favoritesOnly: null }, { limit: null }, { uid: 'member' }, { limit: 21 }, { limit: 1.5 }])('search_rejects_untrusted_input_%#', async input => {
  const f = await setup(); await expect(f.owner.recipes.list(input as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('bounded_search_returns_empty_continuation_and_never_skips_fetched_but_unexamined_candidates', async () => {
  const f = await setup(); await f.owner.recipes.create(f.input()); const [base] = await f.h.rows<RecipeRecord>('recipes');
  for (let i = 1; i <= 125; i++) {
    const id = i.toString(16).padStart(32, '0');
    f.h.memory.seed('recipes', id, { ...base, _id: id, slug: 'seed-' + id, title: i <= 25 ? '匹配菜谱' : '别的菜谱' });
  }
  const first = await f.owner.recipes.list({ query: '匹配', limit: 2 });
  expect(first.items).toEqual([]); expect(first.nextCursor).toBeTypeOf('string');
  const ids: string[] = []; let cursor = first.nextCursor;
  while (cursor) { const page = await f.owner.recipes.list({ query: '匹配', limit: 2, cursor }); ids.push(...page.items.map(r => r.id)); cursor = page.nextCursor; }
  expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => (25 - i).toString(16).padStart(32, '0')));
});

test('cursor_is_bound_to_user_filters_and_membership_generation_and_fits_unicode_filter_limit', async () => {
  const f = await setup();
  for (let i = 0; i < 3; i++) await f.owner.recipes.create({ ...f.input(), recipe: { ...textRecipe(), title: '🍲'.repeat(120), tags: ['🍲'.repeat(40)] } });
  const filters = { query: '🍲'.repeat(120), tag: '🍲'.repeat(40), limit: 1 };
  const first = await f.member.recipes.list(filters); expect(first.nextCursor!.length).toBeLessThanOrEqual(512);
  for (const input of [{ ...filters, query: '🍲' }, { ...filters, tag: '' }, { ...filters, favoritesOnly: true }]) {
    await expect(f.member.recipes.list({ ...input, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  }
  await expect(f.owner.recipes.list({ ...filters, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  const invite = await f.owner.family.invite({ requestId: requestId() }); await f.member.family.join({ requestId: requestId(), token: invite.token });
  await expect(f.member.recipes.list({ ...filters, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('favorites_are_private_set_state_and_receipt_replay_never_reapplies_an_old_state', async () => {
  const f = await setup(); const create = f.input(); const recipe = await f.owner.recipes.create(create);
  const mark = { requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation, id: recipe.id, enabled: true };
  await Promise.all([f.member.recipes.favorite(mark), f.member.recipes.favorite(mark)]);
  expect(await f.h.rows('recipe_favorites')).toHaveLength(1);
  expect((await f.member.recipes.list({ favoritesOnly: true, query: '焗', tag: '' })).items).toMatchObject([{ id: recipe.id, isFavorite: true }]);
  expect(await f.owner.recipes.get(recipe.id)).toMatchObject({ isFavorite: false });
  expect((await f.owner.recipes.list({ favoritesOnly: true })).items).toEqual([]);
  await expect(f.member.recipes.favorite({ ...mark, enabled: false })).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.member.recipes.favorite({ ...mark, requestId: requestId(), enabled: false });
  await f.member.recipes.favorite(mark);
  expect(await f.member.recipes.get(recipe.id)).toMatchObject({ isFavorite: false });
  await f.owner.recipes.favorite({ ...mark, requestId: requestId(), generation: f.view.generation });
  expect(await f.owner.recipes.create(create)).toMatchObject({ isFavorite: true });
  expect(await f.h.rows('recipes')).toEqual([expect.not.objectContaining({ isFavorite: expect.anything() })]);
  const receipts = await f.h.rows<{ operation: string; result: object }>('mutation_receipts');
  expect(receipts.find(r => r.operation === 'recipe-create-v1')!.result).not.toHaveProperty('isFavorite');
});

test('favorite_rejects_foreign_missing_and_forged_target_uid', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  for (const id of [recipe.id, 'f'.repeat(32)]) await expect(f.outsider.recipes.favorite({ requestId: requestId(), familyId: f.other.familyId, generation: f.other.generation, id, enabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const mark = { requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, id: recipe.id, enabled: true };
  for (const patch of [{ uid: 'member' }, { enabled: 1 }, { id: 'bad' }]) await expect(f.owner.recipes.favorite({ ...mark, ...patch } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('recipe_favorites')).toHaveLength(0);
});

test('rejoining_a_family_does_not_restore_favorites_or_authorize_old_first_delivery_and_replay', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  const mark = { requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation, id: recipe.id, enabled: true };
  await f.member.recipes.favorite(mark);
  await f.member.family.leave({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation });
  const invite = await f.owner.family.invite({ requestId: requestId() }); const joined = await f.member.family.join({ requestId: requestId(), token: invite.token });
  expect((await f.member.recipes.list({ favoritesOnly: true })).items).toEqual([]);
  for (const input of [mark, { ...mark, requestId: requestId() }]) await expect(f.member.recipes.favorite(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.member.recipes.favorite({ ...mark, requestId: requestId(), generation: joined.generation });
  expect(await f.member.recipes.get(recipe.id)).toMatchObject({ isFavorite: true });
});

test.each(['insert:recipe_favorites', 'insert:mutation_receipts', 'after-commit'] as const)('favorite_transaction_handles_%s', async stage => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input()); let armed = true;
  const api = createRecipesService({ database: f.h.database, now: () => 1_800_000_000_000, newId: () => 'a'.repeat(32),
    content: { async checkText() { return 'allowed'; } }, reads: { async list() { return []; }, async favorites() { return []; } },
    async revalidateIdentity() { if (armed) { armed = false; f.h.memory.failNext(stage); } },
  }, f.joined);
  const mark = { requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation, id: recipe.id, enabled: true };
  const before = await f.h.rows('family_members');
  if (stage === 'after-commit') { await api.favorite(mark); expect(await f.h.rows('recipe_favorites')).toHaveLength(1); }
  else { await expect(api.favorite(mark)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(await f.h.rows('recipe_favorites')).toEqual([]); expect(await f.h.rows('family_members')).toEqual(before); }
  await api.favorite(mark); expect(await f.member.recipes.get(recipe.id)).toMatchObject({ isFavorite: true });
});

test('favorite_member_fence_prevents_commit_after_removal', async () => {
  const f = await setup(); const recipe = await f.owner.recipes.create(f.input());
  let barrier: ReturnType<typeof f.h.memory.barrierNextCommit> | undefined;
  const api = createRecipesService({ database: f.h.database, now: () => 1_800_000_000_000, newId: () => 'a'.repeat(32),
    content: { async checkText() { return 'allowed'; } }, reads: { async list() { return []; }, async favorites() { return []; } },
    async revalidateIdentity() { if (!barrier) barrier = f.h.memory.barrierNextCommit(); },
  }, f.joined);
  const pending = api.favorite({ requestId: requestId(), familyId: f.joined.familyId, generation: f.joined.generation, id: recipe.id, enabled: true });
  while (!barrier) await new Promise(resolve => setTimeout(resolve, 0)); await barrier.reached;
  await f.owner.family.removeMember({ requestId: requestId(), familyId: f.view.familyId, generation: f.view.generation, uid: 'member', targetGeneration: f.joined.generation });
  barrier.release(); await expect(pending).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' }); expect(await f.h.rows('recipe_favorites')).toEqual([]);
});
