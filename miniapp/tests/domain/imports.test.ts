import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';
import type { Job, Usage } from '../../uniCloud-alipay/cloudfunctions/common/home-imports';
import { defaultConfig } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/model';
import { createOpenRouterProvider, ImportFailure } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/provider';
import { DatabaseFault } from 'home-kernel';

const recipe = () => ({ title: '盐汤', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['加水煮开。'], tags: [] });
const usage = () => ({ inputTokens: 20, outputTokens: 40, costUsd: 0.001, providerRequestId: 'fixture-request' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function setup(options: Parameters<typeof createHarness>[0] = {}) {
  const h = createHarness(options); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const home = await client.family.create({ requestId: 'imports-home-create-01', name: '家' });
  const input = (requestId = 'imports-submit-text-01') => ({ requestId, familyId: home.familyId, generation: home.generation, source: { kind: 'text' as const, text: '盐汤：盐适量，加水煮开。' } });
  return { h, client, home, input, async submit(id?: string) { return client.imports.submit(input(id)); } };
}

test('text_import_replays_one_job_and_worker_atomically_saves_one_recipe', async () => {
  const h = createHarness(); await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const home = await client.family.create({ requestId: 'imports-home-create-01', name: '家' });
  const input = { requestId: 'imports-submit-text-01', familyId: home.familyId, generation: home.generation, source: { kind: 'text' as const, text: '盐汤：盐适量，加水煮开。' } };
  const job = await client.imports.submit(input);
  expect(job).toMatchObject({ state: 'queued', attempts: 0, recipeId: null, error: null });
  expect(await client.imports.submit(input)).toEqual(job);
  await expect(client.imports.submit({ ...input, source: { kind: 'text', text: '不同文本' } })).rejects.toMatchObject({ code: 'CONFLICT' });
  await h.runImports(); await h.runImports();
  const result = await client.imports.get(job.id);
  expect(result).toMatchObject({ state: 'succeeded', attempts: 1, error: null });
  expect(await h.rows('recipes')).toHaveLength(1);
  expect(await client.recipes.get(result.recipeId!)).toMatchObject({ source: { kind: 'text', importJobId: job.id }, createdBy: 'alice' });
  expect(await h.rows('ai_usage')).toMatchObject([{ currency: 'USD', costUsd: 0.001, inputTokens: 20, outputTokens: 40, providerRequestId: 'fixture-request' }]);
  expect(JSON.stringify(result)).not.toContain('盐汤');
});

test('concurrent_submission_and_atomic_user_family_task_quota', async () => {
  const f = await setup({ importsConfig: () => ({ ...defaultConfig(), enabled: true, userTasks: 1, familyTasks: 1 }) });
  const [a, b] = await Promise.all([f.submit(), f.submit()]); expect(a.id).toBe(b.id);
  await expect(f.submit('imports-submit-text-02')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await f.h.rows('import_jobs')).toHaveLength(1);
  expect(await f.h.rows('quota_buckets')).toMatchObject([{ tasks: 1 }, { tasks: 1 }]);
});
test('failed_family_reservation_rolls_back_user_reservation_and_job', async () => {
  const f = await setup({ importsConfig: () => ({ ...defaultConfig(), enabled: true, userTasks: 2, familyTasks: 0 }) });
  await expect(f.submit()).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(await f.h.rows('quota_buckets')).toEqual([]); expect(await f.h.rows('import_jobs')).toEqual([]);
});
test('only_creator_in_original_membership_can_query_and_cancel', async () => {
  const f = await setup(); const job = await f.submit(); await f.h.seedIdentity({ uid: 'bob' }); const bob = f.h.client('bob');
  const invite = await f.client.family.invite({ requestId: 'imports-invite-bob-01' }); const joined = await bob.family.join({ requestId: 'imports-join-bob-01', token: invite.token });
  await expect(bob.imports.get(job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(bob.imports.cancel({ requestId: 'imports-cancel-bob-01', familyId: joined.familyId, generation: joined.generation, id: job.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.h.database.transaction(async tx => { const row = await tx.get<Record<string, unknown>>('family_members', 'alice'); await tx.replace('family_members', 'alice', { ...row, _id: 'alice', generation: 'new-generation' }); });
  await expect(f.client.imports.get(job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.h.runImports(); expect(await f.h.rows('import_jobs')).toMatchObject([{ state: 'failed', error: 'MEMBERSHIP_CHANGED' }]);
  expect(await f.h.rows('ai_usage')).toHaveLength(0);
});
test('cancel_wins_during_provider_call_but_usage_is_still_settled', async () => {
  const entered = deferred<void>(); const result = deferred<{ recipe: ReturnType<typeof recipe>; usage: ReturnType<typeof usage> }>();
  const f = await setup({ importsProvider: { async parse() { entered.resolve(); return result.promise; } } }); const job = await f.submit();
  const work = f.h.runImports(); await entered.promise;
  const cancelled = await f.client.imports.cancel({ requestId: 'imports-cancel-text-01', familyId: f.home.familyId, generation: f.home.generation, id: job.id });
  expect(cancelled.state).toBe('cancelled'); result.resolve({ recipe: recipe(), usage: usage() }); await work;
  expect((await f.client.imports.get(job.id)).state).toBe('cancelled'); expect(await f.h.rows('recipes')).toHaveLength(0);
  expect(await f.h.rows('ai_usage')).toMatchObject([{ settled: true, costUsd: 0.001 }]);
});
test('completion_wins_later_cancel_and_repeated_cancel_are_terminal', async () => {
  const f = await setup(); const job = await f.submit(); await f.h.runImports();
  for (let i = 0; i < 2; i++) expect((await f.client.imports.cancel({ requestId: 'imports-cancel-text-01', familyId: f.home.familyId, generation: f.home.generation, id: job.id })).state).toBe('succeeded');
});
test('stale_worker_cannot_save_after_a_new_lease_but_both_calls_are_accounted', async () => {
  const entered = deferred<void>(); const slow = deferred<{ recipe: ReturnType<typeof recipe>; usage: ReturnType<typeof usage> }>(); let calls = 0;
  const f = await setup({ importsProvider: { async parse() { if (++calls === 1) { entered.resolve(); return slow.promise; } return { recipe: recipe(), usage: usage() }; } } });
  const job = await f.submit(); const first = f.h.runImports(); await entered.promise; f.h.advance(90001); await f.h.runImports();
  slow.resolve({ recipe: { ...recipe(), title: '过期结果' }, usage: usage() }); await first;
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'succeeded', attempts: 2 });
  expect(await f.h.rows('recipes')).toMatchObject([{ title: '盐汤' }]); expect(await f.h.rows('ai_usage')).toHaveLength(2);
  expect((await f.h.rows<Usage>('ai_usage')).every(row => row.settled && row.costUsd === 0.001)).toBe(true);
});
test('late_actual_usage_upgrades_unknown_settlement_after_a_reclaimed_worker_fails_eligibility', async () => {
  const entered = deferred<void>(); const result = deferred<{ recipe: ReturnType<typeof recipe>; usage: ReturnType<typeof usage> }>(); let visited = true;
  const f = await setup({ recentlyVisited: async () => visited, importsProvider: { async parse() { entered.resolve(); return result.promise; } } });
  await f.submit(); const first = f.h.runImports(); await entered.promise; f.h.advance(90001); visited = false; await f.h.runImports();
  expect(await f.h.rows('ai_usage')).toMatchObject([{ settled: true, costUsd: null }]);
  result.resolve({ recipe: recipe(), usage: usage() }); await first;
  expect(await f.h.rows('ai_usage')).toMatchObject([{ settled: true, costUsd: 0.001, inputTokens: 20, outputTokens: 40 }]);
  expect((await f.h.rows<{ heldUsd: number; spentUsd: number }>('quota_buckets')).every(row => row.heldUsd === 0 && row.spentUsd === 0.001)).toBe(true);
  expect(await f.h.rows('recipes')).toHaveLength(0);
});
test('three_transient_attempts_use_60_then_120_second_backoff_and_retain_unknown_cost', async () => {
  const f = await setup({ importsProvider: { async parse() { throw new ImportFailure('PROVIDER_UNAVAILABLE', true); } } }); const job = await f.submit();
  await f.h.runImports(); expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'queued', attempts: 1 });
  f.h.advance(59999); await f.h.runImports(); expect((await f.client.imports.get(job.id)).attempts).toBe(1);
  f.h.advance(1); await f.h.runImports(); f.h.advance(119999); await f.h.runImports(); expect((await f.client.imports.get(job.id)).attempts).toBe(2);
  f.h.advance(1); await f.h.runImports(); expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', attempts: 3 });
  expect(await f.h.rows('ai_usage')).toHaveLength(3);
  expect((await f.h.rows<{ heldUsd: number }>('quota_buckets')).every(row => row.heldUsd === 3)).toBe(true);
});
test('audit_failure_is_terminal_and_never_repeats_the_provider', async () => {
  let armed = false; const f = await setup({ content: { async checkText() { if (armed) throw new Error('secret'); return 'allowed'; } } });
  const job = await f.submit(); armed = true; await f.h.runImports(); f.h.advance(180000); await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', attempts: 1, error: 'AUDIT_UNAVAILABLE' });
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.001, settled: true }]); expect(await f.h.rows('recipes')).toHaveLength(0);
});
test('audit_interruption_resumes_validated_candidate_without_recalling_ai_or_losing_cost', async () => {
  const entered = deferred<void>(); const audit = deferred<'allowed'>(); let armed = false; let audits = 0;
  const f = await setup({ content: { async checkText() { if (armed && ++audits === 1) { entered.resolve(); return audit.promise; } return 'allowed'; } } });
  const job = await f.submit(); armed = true; const first = f.h.runImports(); await entered.promise; f.h.advance(90001); await f.h.runImports(); audit.resolve('allowed'); await first;
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'succeeded', attempts: 1 });
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.001, settled: true }]);
});
test.each(['cancel', 'membership', 'retention', 'visit', 'account'] as const)('interrupted_candidate_%s_settles_checkpointed_usage_without_another_provider_call', async reason => {
  const entered = deferred<void>(); const audit = deferred<'allowed'>(); let armed = false; let visited = true;
  const f = await setup({ recentlyVisited: async () => visited, content: { async checkText() { if (armed) { entered.resolve(); return audit.promise; } return 'allowed'; } } });
  const job = await f.submit(); armed = true; const first = f.h.runImports(); await entered.promise;
  if (reason === 'cancel') await f.client.imports.cancel({ requestId: 'imports-cancel-text-01', familyId: f.home.familyId, generation: f.home.generation, id: job.id });
  else {
    if (reason === 'membership') await f.h.database.transaction(tx => tx.remove('family_members', 'alice'));
    if (reason === 'account') f.h.closeAccount('alice');
    if (reason === 'visit') visited = false;
    f.h.advance(reason === 'retention' ? 7 * 86400000 : 90001); await f.h.runImports();
  }
  // Assert before the stale worker returns: another worker must recover the persisted accounting.
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.001, inputTokens: 20, outputTokens: 40, settled: true }]);
  expect((await f.h.rows<{ heldUsd: number; spentUsd: number }>('quota_buckets')).every(row => row.heldUsd === 0 && row.spentUsd === 0.001)).toBe(true);
  audit.resolve('allowed'); await first; expect(await f.h.rows('recipes')).toHaveLength(0);
});
test('concurrent_budget_reservations_allow_only_one_provider_call', async () => {
  const entered = deferred<void>(); const result = deferred<{ recipe: ReturnType<typeof recipe>; usage: ReturnType<typeof usage> }>();
  const f = await setup({ importsConfig: () => ({ ...defaultConfig(), enabled: true, globalUsd: 1 }), importsProvider: { async parse() { entered.resolve(); return result.promise; } } });
  await f.submit(); const second = await f.submit('imports-submit-text-02'); const work = f.h.runImports(); await entered.promise; await f.h.runImports();
  expect(await f.client.imports.get(second.id)).toMatchObject({ state: 'failed', error: 'BUDGET_EXCEEDED', attempts: 0 });
  result.resolve({ recipe: recipe(), usage: usage() }); await work; expect(await f.h.rows('ai_usage')).toHaveLength(1);
});
test('disabled_switch_blocks_new_calls_but_inflight_result_saves_and_cleanup_still_runs', async () => {
  let enabled = true; const entered = deferred<void>(); const result = deferred<{ recipe: ReturnType<typeof recipe>; usage: ReturnType<typeof usage> }>();
  const f = await setup({ importsConfig: () => ({ ...defaultConfig(), enabled }), importsProvider: { async parse() { entered.resolve(); return result.promise; } } });
  const job = await f.submit(); const other = await f.submit('imports-submit-text-02'); const work = f.h.runImports(); await entered.promise; enabled = false;
  await expect(f.submit('imports-submit-text-03')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  result.resolve({ recipe: recipe(), usage: usage() }); await work; expect((await f.client.imports.get(job.id)).state).toBe('succeeded');
  expect((await f.client.imports.get(other.id)).attempts).toBe(0); f.h.advance(7 * 86400000); await f.h.runImports();
  expect(await f.h.rows<Job>('import_jobs')).toMatchObject([{ sourceText: null }, { state: 'failed', error: 'INPUT_EXPIRED', sourceText: null }]);
});
test('unknown_submit_and_final_commit_acknowledgment_are_read_back', async () => {
  const f = await setup({ content: { async checkText() { return 'allowed'; } } });
  // Call directly so the injected failure targets the job transaction, rather than a preliminary rate limit.
  const { createImportsService } = await import('../../uniCloud-alipay/cloudfunctions/common/home-imports');
  const service = createImportsService({ database: f.h.database, now: () => f.h.now, config: () => ({ ...defaultConfig(), enabled: true }), async revalidateIdentity() {} }, f.home);
  const original = f.h.database.transaction; let armed = true;
  f.h.database.transaction = fn => original(async tx => fn({ ...tx, async insert(collection, id, value) { await tx.insert(collection, id, value); if (collection === 'import_jobs' && armed) { armed = false; f.h.memory.failNext('after-commit'); } } }));
  const job = await service.submit(f.input()); expect(job.state).toBe('queued');
  f.h.database.transaction = fn => original(async tx => fn({ ...tx, async insert(collection, id, value) { await tx.insert(collection, id, value); if (collection === 'recipes') f.h.memory.failNext('after-commit', new DatabaseFault('commit-unknown')); } }));
  await f.h.runImports(); expect((await service.get(job.id)).state).toBe('succeeded'); expect(await f.h.rows('recipes')).toHaveLength(1);
});
test('old_wechat_visit_fails_before_paid_call_with_actionable_error', async () => {
  const f = await setup({ recentlyVisited: async () => false }); const job = await f.submit(); await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', attempts: 0, error: 'AUDIT_VISIT_REQUIRED' }); expect(await f.h.rows('ai_usage')).toHaveLength(0);
});
test('expired_backlog_beyond_cleanup_batch_never_reaches_provider', async () => {
  const f = await setup(); for (let i = 0; i < 21; i++) await f.submit('imports-backlog-' + String(i).padStart(4, '0'));
  f.h.advance(7 * 86400000); await f.h.runImports();
  expect(await f.h.rows('ai_usage')).toHaveLength(0); expect(await f.h.rows('recipes')).toHaveLength(0);
  expect((await f.h.rows<Job>('import_jobs')).every(row => row.state === 'failed' && row.error === 'INPUT_EXPIRED' && row.sourceText === null)).toBe(true);
});
test('expiry_during_provider_call_accounts_cost_but_cannot_save_expired_text', async () => {
  const entered = deferred<void>(); const result = deferred<{ recipe: ReturnType<typeof recipe>; usage: ReturnType<typeof usage> }>();
  const f = await setup({ importsProvider: { async parse() { entered.resolve(); return result.promise; } } }); const job = await f.submit();
  f.h.advance(7 * 86400000 - 1); const work = f.h.runImports(); await entered.promise; f.h.advance(2); result.resolve({ recipe: recipe(), usage: usage() }); await work;
  expect((await f.h.rows<Job>('import_jobs')).find(row => row._id === job.id)).toMatchObject({ state: 'failed', error: 'INPUT_EXPIRED' }); expect(await f.h.rows('recipes')).toHaveLength(0);
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.001, settled: true }]);
});
test.each(['image'])('unsupported_%s_is_unavailable_without_reserving_quota', async kind => {
  const f = await setup(); await expect(f.client.imports.submit({ ...f.input(), source: { kind } } as never)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); expect(await f.h.rows('import_jobs')).toHaveLength(0);
});
test.each(['', '字'.repeat(5462), 'bad\u0000text', '\uD800'])('invalid_text_never_creates_a_job_%#', async text => {
  const f = await setup(); await expect(f.client.imports.submit({ ...f.input(), source: { kind: 'text', text } })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(await f.h.rows('quota_buckets')).toHaveLength(0);
});

test.each([
  [{ ...recipe(), createdBy: 'attacker' }, 'INVALID_OUTPUT'], [{ ...recipe(), ingredients: [] }, 'INVALID_OUTPUT'],
  [{ ...recipe(), steps: ['x'.repeat(2001)] }, 'INVALID_OUTPUT'], [{ ...recipe(), baseServings: '2' }, 'INVALID_OUTPUT'],
])('model_cannot_forge_fields_or_bypass_existing_recipe_validation_%#', async (value, code) => {
  const provider = createOpenRouterProvider({ apiKey: () => 'fixture', request: async () => ({ status: 200, body: JSON.stringify({ id: 'provider-1', usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.002 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ outcome: 'recipe', recipe: value }) } }] }) }) });
  const f = await setup({ importsProvider: provider }); const job = await f.submit(); await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', error: code, attempts: 1 }); expect(await f.h.rows('recipes')).toHaveLength(0);
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.002, providerRequestId: 'provider-1' }]);
});
