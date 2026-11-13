import { expect, test } from 'vitest';
import { mediaFixture, png, request, recipeInput } from '../support/media-fixtures';
import { receiveReview } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import type { MediaRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import type { Job } from '../../uniCloud-alipay/cloudfunctions/common/home-imports';
import { defaultConfig } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/model';
import { ImportFailure } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/provider';
import { cleanupImportMedia } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import type { createHarness } from '../support/harness';

async function setup(options: Parameters<typeof createHarness>[0] = {}) {
  const f = await mediaFixture({ importsConfig: () => ({ ...defaultConfig(), enabled: true, imageEnabled: true }),
    review: { mode: 'mock', async submit(row) { return 'image-' + row._id; } }, ...options });
  async function image() {
    const result = await f.upload('import-input');
    await receiveReview({ database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive }, 'image-' + result.mediaId, 'pass');
    return result.mediaId;
  }
  const input = (mediaId: string, requestId = request()) => ({ ...f.scope, requestId, source: { kind: 'image' as const, mediaId } });
  return { ...f, image, input };
}
test('image_import_uses_verified_bytes_and_saves_one_recipe_without_original_image_or_link', async () => {
  const seen: unknown[] = [];
  const f = await setup({ importsProvider: { async parse(input) { seen.push(input); return { recipe: recipeInput(), usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.001, providerRequestId: 'vision-1' } }; } } });
  const id = await f.image(); const input = f.input(id); const job = await f.owner.imports.submit(input);
  expect(await f.owner.imports.submit(input)).toEqual(job);
  await f.h.runImports(); await f.h.runImports();
  const result = await f.owner.imports.get(job.id);
  expect(result).toMatchObject({ state: 'succeeded', attempts: 1 });
  expect(seen).toEqual([{ kind: 'image', mime: 'image/png', base64: png.toString('base64') }]);
  expect(await f.owner.recipes.get(result.recipeId!)).toMatchObject({ source: { kind: 'image', url: null, importJobId: job.id }, imageIds: [], baseServings: null, ingredients: [{ quantity: null, unit: null }] });
  expect(await f.h.rows('recipes')).toHaveLength(1);
  expect(await f.h.rows('import_jobs')).toMatchObject([{ sourceMediaId: null, candidate: null }]);
  expect(JSON.stringify(result)).not.toMatch(/base64|cloud:|mediaId/);
  expect(await f.owner.imports.submit(input)).toEqual(result);
});
test('image_inputs_require_creator_scope_purpose_review_and_single_job_binding', async () => {
  const f = await setup(); const id = await f.image();
  await expect(f.member.imports.submit({ ...f.input(id), ...f.memberScope })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.outsider.imports.submit({ ...f.input(id), familyId: f.other.familyId, generation: f.other.generation })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const cover = await f.upload('recipe-image');
  await expect(f.owner.imports.submit(f.input(cover.mediaId))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const pending = await f.upload('import-input');
  await expect(f.owner.imports.submit(f.input(pending.mediaId))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await f.owner.imports.submit(f.input(id));
  await expect(f.owner.imports.submit(f.input(id))).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(f.owner.media.read({ ...f.scope, mediaId: id })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('import_jobs')).toHaveLength(1);
});
test('image_switch_and_disabled_review_do_not_reserve_tasks', async () => {
  const disabled = await setup({ importsConfig: () => ({ ...defaultConfig(), enabled: true }) });
  await expect(disabled.owner.imports.submit(disabled.input(await disabled.image()))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(await disabled.h.rows('quota_buckets')).toEqual([]);
  const f = await setup({ review: { mode: 'disabled', async submit() { throw new Error(); } } });
  const media = await f.upload('import-input');
  await expect(f.owner.imports.submit(f.input(media.mediaId))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('quota_buckets')).toEqual([]);
});
test('expired_image_is_definitively_rejected_and_corrupt_bytes_never_reach_provider', async () => {
  let calls = 0; const f = await setup({ importsProvider: { async parse() { calls++; throw new Error(); } } });
  const expired = await f.image(); f.h.advance(7 * 86400000); await f.h.seedIdentity({ uid: 'owner' });
  await expect(f.owner.imports.submit(f.input(expired))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const id = await f.image(); const job = await f.owner.imports.submit(f.input(id));
  const row = (await f.h.rows<MediaRecord>('media_files')).find(row => row._id === id)!;
  f.h.files.set(row.fileId!, Buffer.from('corrupt'));
  await f.h.runImports();
  expect(await f.owner.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'IMAGE_UNREADABLE' });
  expect(calls).toBe(0); expect(await f.h.rows('recipes')).toEqual([]);
  expect((await f.h.rows<{ costUsd: number }>('ai_usage')).every(row => row.costUsd === 0)).toBe(true);
});
test('image_outcomes_and_retry_costs_use_existing_job_lifecycle', async () => {
  let calls = 0; const f = await setup({ importsProvider: { async parse() { calls++; throw new ImportFailure(calls === 1 ? 'PROVIDER_UNAVAILABLE' : 'UNRECOGNIZED', calls === 1); } } });
  const job = await f.owner.imports.submit(f.input(await f.image()));
  await f.h.runImports(); expect(await f.owner.imports.get(job.id)).toMatchObject({ state: 'queued', attempts: 1 });
  f.h.advance(60000); await f.h.runImports();
  expect(await f.owner.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'UNRECOGNIZED', attempts: 2 });
  expect(await f.h.rows('recipes')).toEqual([]);
});
test('image_cleanup_removes_bytes_but_keeps_upload_and_job_replay_tombstones', async () => {
  const f = await setup(); const id = await f.image(); const input = f.input(id); const job = await f.owner.imports.submit(input);
  await f.owner.imports.cancel({ ...f.scope, requestId: request(), id: job.id });
  await f.h.runImports();
  expect(f.h.files.size).toBe(0);
  const row = (await f.h.rows<MediaRecord>('media_files')).find(row => row._id === id)!;
  expect(row).toMatchObject({ state: 'failed', fileId: null, cloudPath: null, garbagePaths: [], importJobId: job.id });
  expect(await f.owner.imports.submit(input)).toMatchObject({ id: job.id, state: 'cancelled' });
});
test('image_expiry_during_provider_call_accounts_usage_without_saving', async () => {
  const f = await setup({ importsProvider: { async parse() { f.h.advance(2); return { recipe: recipeInput(), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.002, providerRequestId: 'late-image' } }; } } });
  const id = await f.image(); f.h.advance(7 * 86400000 - 1); await f.h.seedIdentity({ uid: 'owner' }); const job = await f.owner.imports.submit(f.input(id));
  await f.h.runImports();
  expect(await f.owner.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'INPUT_EXPIRED' });
  expect(await f.h.rows('recipes')).toEqual([]);
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.002, settled: true }]);
  expect((await f.h.rows<Job>('import_jobs'))[0].sourceMediaId).toBeNull();
});
test('missing_media_record_fails_job_without_leaving_it_running', async () => {
  const f = await setup(); const id = await f.image(); const job = await f.owner.imports.submit(f.input(id));
  await f.h.database.transaction(tx => tx.remove('media_files', id));
  await f.h.runImports();
  expect(await f.owner.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'IMAGE_UNREADABLE' });
});
test('cleanup_handles_upload_orphans_and_defers_failed_deletes_without_touching_covers', async () => {
  const f = await setup(); const id = await f.image(); const cover = await f.upload('recipe-image');
  const row = (await f.h.rows<MediaRecord>('media_files')).find(row => row._id === id)!;
  await f.h.database.transaction(tx => tx.replace('media_files', id, { ...row, state: 'failed', fileId: null, garbagePaths: [row.cloudPath!], cleanupAt: f.h.now }));
  let fail = true; const storage = { ...f.h.storage, async remove(paths: string[]) { if (fail) throw new Error('storage unavailable'); await f.h.storage.remove(paths); } };
  const cleanup = () => cleanupImportMedia({ database: f.h.database, storage, now: () => f.h.now, ids: [id, cover.mediaId] });
  expect(await cleanup()).toBe(0); expect(f.h.files.size).toBe(2);
  expect((await f.h.rows<MediaRecord>('media_files')).find(row => row._id === id)?.cleanupAt).toBe(f.h.now + 300000);
  fail = false; expect(await cleanup()).toBe(0); f.h.advance(300000);
  expect(await cleanup()).toBe(1); expect(f.h.files.size).toBe(1);
  expect((await f.h.rows<MediaRecord>('media_files')).find(row => row._id === cover.mediaId)?.fileId).not.toBeNull();
});
test('rejected_image_and_old_membership_never_reach_ai', async () => {
  const f = await setup(); const rejected = await f.upload('import-input');
  await receiveReview({ database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive }, 'image-' + rejected.mediaId, 'reject');
  await expect(f.owner.imports.submit(f.input(rejected.mediaId))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const id = await f.image(); const job = await f.owner.imports.submit(f.input(id));
  await f.h.database.transaction(async tx => { const row = await tx.get<Record<string, unknown>>('family_members', 'owner'); await tx.replace('family_members', 'owner', { ...row, generation: 'new-generation' }); });
  await f.h.runImports(); expect(await f.h.rows('ai_usage')).toEqual([]);
  expect(await f.h.rows('import_jobs')).toMatchObject([{ _id: job.id, state: 'failed', error: 'MEMBERSHIP_CHANGED' }]);
});
