import { expect, test } from 'vitest';
import { mediaFixture, png, jpeg, paddedPng, request, recipeInput } from '../support/media-fixtures';
import { deferCall } from '../support/sdk-transport';
import { receiveReview } from '../../uniCloud-alipay/cloudfunctions/common/home-media';
import { decodeFile, validateFile } from '../../uniCloud-alipay/cloudfunctions/common/home-media/files';
import type { MediaRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-media';

test('checks_actual_png_crc_and_base64_before_storage', () => {
  expect(validateFile(png, 'image/png', png.length)).toMatch(/^[a-f0-9]{64}$/);
  const corrupt = Buffer.from(png); corrupt[42] ^= 1;
  for (const [bytes, mime, size] of [[corrupt, 'image/png', png.length], [png, 'image/jpeg', png.length], [png, 'image/png', png.length + 1], [Buffer.from('pretend'), 'image/png', 7]] as const)
    expect(() => validateFile(bytes, mime, size)).toThrow();
  for (const encoded of ['x'.repeat(1_398_105), png.toString('base64') + '\n', '!!!!', '']) expect(() => decodeFile(encoded, 'image/png', png.length)).toThrow();
});
test('accepts_real_jpeg_and_exact_1MiB_png_and_rejects_truncation', () => {
  expect(validateFile(jpeg, 'image/jpeg', jpeg.length)).toMatch(/^[a-f0-9]{64}$/);
  expect(() => validateFile(jpeg.subarray(0, -1), 'image/jpeg', jpeg.length - 1)).toThrow();
  const boundary = paddedPng(1048576);
  expect(decodeFile(boundary.toString('base64'), 'image/png', boundary.length).bytes.length).toBe(1048576);
  const oversized = paddedPng(1048577); expect(() => decodeFile(oversized.toString('base64'), 'image/png', oversized.length)).toThrow();
});
test('disabled_review_uploads_binds_reads_and_text_updates_keep_images', async () => {
  const f = await mediaFixture(); const media = await f.upload(); expect(media).toMatchObject({ state: 'ready', review: 'disabled' });
  const recipe = await f.recipe(); const bind = { ...f.scope, requestId: request(), id: recipe.id, version: 1, imageIds: [media.mediaId] };
  const result = await f.owner.recipes.bindImages(bind); expect(result).toMatchObject({ version: 2, imageIds: [media.mediaId] });
  expect(await f.owner.recipes.bindImages(bind)).toEqual(result);
  expect(await f.member.media.read({ ...f.memberScope, mediaId: media.mediaId })).toMatchObject({ mediaId: media.mediaId, expiresAt: f.h.now + 600000 });
  expect(await f.owner.recipes.update({ ...f.scope, requestId: request(), id: recipe.id, version: 2, recipe: recipeInput() })).toMatchObject({ version: 3, imageIds: [media.mediaId] });
  await expect(f.owner.recipes.bindImages({ ...bind, requestId: request() })).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.member.recipes.bindImages({ ...f.memberScope, requestId: request(), id: recipe.id, version: 3, imageIds: [] });
  expect((await f.h.rows<MediaRecord>('media_files'))[0]).toMatchObject({ recipeId: null, cleanupAt: f.h.now + 86400000 });
  await expect(f.member.media.read({ ...f.memberScope, mediaId: media.mediaId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
test('unpublished_foreign_wrong_purpose_and_arbitrary_files_cannot_bind', async () => {
  const f = await mediaFixture(); const media = await f.upload(); const imported = await f.upload('import-input'); const recipe = await f.recipe();
  await expect(f.member.media.read({ ...f.memberScope, mediaId: media.mediaId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(f.outsider.media.read({ familyId: f.other.familyId, generation: f.other.generation, mediaId: media.mediaId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  for (const imageIds of [[imported.mediaId], ['cloud://arbitrary/file.png'], [media.mediaId, media.mediaId], Array(21).fill(media.mediaId), ['f'.repeat(32)]])
    await expect(f.owner.recipes.bindImages({ ...f.scope, requestId: request(), id: recipe.id, version: 1, imageIds })).rejects.toBeDefined();
  await expect(f.member.recipes.bindImages({ ...f.memberScope, requestId: request(), id: recipe.id, version: 1, imageIds: [media.mediaId] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
test('allocation_is_idempotent_and_rejects_limits_and_payload_changes', async () => {
  const f = await mediaFixture(); const input = { ...f.scope, requestId: request(), purpose: 'recipe-image' as const, mime: 'image/png' as const, bytes: 1048576 };
  const view = await f.owner.media.requestUpload(input); expect(await f.owner.media.requestUpload(input)).toEqual(view);
  await expect(f.owner.media.requestUpload({ ...input, bytes: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
  for (const bytes of [0, 1048577, 1.5, NaN]) await expect(f.owner.media.requestUpload({ ...input, requestId: request(), bytes })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  for (const patch of [{ mime: 'image/webp' }, { purpose: 'avatar' }, { path: 'overwrite' }]) await expect(f.owner.media.requestUpload(Object.assign({ ...input, requestId: request() }, patch))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  f.h.advance(300001); await expect(f.owner.media.upload({ ...f.scope, mediaId: view.mediaId, base64: png.toString('base64') })).rejects.toBeDefined();
});
test('complete_rechecks_stored_digest_and_repeated_calls_do_not_resubmit', async () => {
  const f = await mediaFixture(); const media = await f.allocate(); const ref = { ...f.scope, mediaId: media.mediaId };
  await f.owner.media.upload({ ...ref, base64: png.toString('base64') });
  const [row] = await f.h.rows<MediaRecord>('media_files'); f.h.files.set(row.fileId!, Buffer.from('replaced'));
  await expect(f.owner.media.complete(ref)).rejects.toBeDefined();
  expect((await f.h.rows<MediaRecord>('media_files'))[0]).toMatchObject({ state: 'failed' });
});
test('pending_review_replays_once_and_signed_rejection_cannot_be_revived', async () => {
  let submits = 0; const f = await mediaFixture({ review: { mode: 'mock', async submit() { return 'trace-' + ++submits; } } });
  const media = await f.upload(); const ref = { ...f.scope, mediaId: media.mediaId }; expect(media.state).toBe('pending');
  await f.owner.media.complete(ref); expect(submits).toBe(1);
  const recipe = await f.recipe(); await expect(f.owner.recipes.bindImages({ ...f.scope, requestId: request(), id: recipe.id, version: 1, imageIds: [media.mediaId] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const deps = { database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive };
  await receiveReview(deps, 'trace-1', 'reject'); await receiveReview(deps, 'trace-1', 'pass');
  expect(await f.owner.media.status({ ...f.scope, mediaIds: [media.mediaId] })).toMatchObject([{ state: 'rejected', review: 'mock' }]);
});
test('timed_out_review_requires_explicit_retry_and_late_trace_cannot_win', async () => {
  let submits = 0; const f = await mediaFixture({ review: { mode: 'mock', async submit() { return 'trace-' + ++submits; } } });
  const media = await f.upload(); f.h.advance(1800001);
  expect(await f.owner.media.status({ ...f.scope, mediaIds: [media.mediaId] })).toMatchObject([{ state: 'review-error' }]);
  await f.owner.media.complete({ ...f.scope, mediaId: media.mediaId });
  const deps = { database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive };
  await receiveReview(deps, 'trace-1', 'pass'); expect((await f.h.rows<MediaRecord>('media_files'))[0].state).toBe('pending');
  await receiveReview(deps, 'trace-2', 'pass'); expect((await f.h.rows<MediaRecord>('media_files'))[0].state).toBe('ready');
});
test.each(['remove', 'revoke', 'rejoin'] as const)('delayed_upload_%s_cannot_advance_and_leaves_cleanup', async mode => {
  const entered = deferCall(); const wait = deferCall();
  const f = await mediaFixture({ storage: { async upload(path) { entered.resolve(null); await wait.promise; return 'cloud://mock/' + path; }, async read() { return png; }, async sign() { throw new Error(); }, async remove() {} } });
  const media = await f.member.media.requestUpload({ ...f.memberScope, requestId: request(), purpose: 'recipe-image', mime: 'image/png', bytes: png.length });
  const pending = f.member.media.upload({ ...f.memberScope, mediaId: media.mediaId, base64: png.toString('base64') }); await entered.promise;
  if (mode === 'revoke') f.h.revokeToken('member');
  else {
    await f.owner.family.removeMember({ ...f.scope, requestId: request(), uid: 'member', targetGeneration: f.joined.generation });
    if (mode === 'rejoin') { const invite = await f.owner.family.invite({ requestId: request() }); await f.member.family.join({ requestId: request(), token: invite.token }); }
  }
  wait.resolve(null); await expect(pending).rejects.toBeDefined();
  expect((await f.h.rows<MediaRecord>('media_files'))[0]).toMatchObject({ state: 'failed', cleanupAt: f.h.now + 86400000 });
});
test('callback_after_removal_or_signout_fails_and_never_becomes_ready', async () => {
  for (const revoke of [false, true]) {
    const f = await mediaFixture({ review: { mode: 'mock', async submit() { return 'trace'; } } }); const media = await f.upload();
    if (revoke) f.h.revokeToken('owner'); else await f.owner.family.leave({ ...f.scope, requestId: request() }).catch(async () => {
      await f.owner.family.transferOwner({ ...f.scope, requestId: request(), uid: 'member', targetGeneration: f.joined.generation });
      const current = (await f.owner.family.current())!; await f.owner.family.leave({ familyId: current.familyId, generation: current.generation, requestId: request() });
    });
    await receiveReview({ database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive }, 'trace', 'pass');
    expect((await f.h.rows<MediaRecord>('media_files')).find(row => row._id === media.mediaId)?.state).toBe('failed');
  }
});
test('lost_bind_ack_recovers_and_failure_rolls_back_media_and_recipe_together', async () => {
  const f = await mediaFixture(); const media = await f.upload(); const recipe = await f.recipe();
  const input = { ...f.scope, requestId: request(), id: recipe.id, version: 1, imageIds: [media.mediaId] };
  const transaction = f.h.database.transaction;
  let armed = true;
  f.h.database.transaction = fn => transaction(async tx => fn({ ...tx, async replace(collection, id, row) {
    await tx.replace(collection, id, row); if (armed && collection === 'recipes') { armed = false; f.h.memory.failNext('after-commit'); }
  } }));
  expect(await f.owner.recipes.bindImages(input)).toMatchObject({ version: 2, imageIds: [media.mediaId] });
  f.h.database.transaction = transaction;
  for (const stage of ['replace:recipes', 'insert:mutation_receipts'] as const) {
    f.h.memory.failNext(stage);
    await expect(f.owner.recipes.bindImages({ ...input, requestId: request(), version: 2, imageIds: [] })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await f.owner.recipes.get(recipe.id)).imageIds).toEqual([media.mediaId]);
    expect((await f.h.rows<MediaRecord>('media_files'))[0]).toMatchObject({ recipeId: recipe.id, cleanupAt: null });
  }
});
test('removal_during_review_submission_fences_late_registration', async () => {
  const entered = deferCall(); const release = deferCall();
  const f = await mediaFixture({ review: { mode: 'mock', async submit() { entered.resolve(null); await release.promise; return 'late-trace'; } } });
  const view = await f.member.media.requestUpload({ ...f.memberScope, requestId: request(), purpose: 'recipe-image', mime: 'image/png', bytes: png.length });
  const ref = { ...f.memberScope, mediaId: view.mediaId }; await f.member.media.upload({ ...ref, base64: png.toString('base64') });
  const pending = f.member.media.complete(ref); await entered.promise;
  await f.owner.family.removeMember({ ...f.scope, requestId: request(), uid: 'member', targetGeneration: f.joined.generation }); release.resolve(null);
  await expect(pending).rejects.toMatchObject({ code: 'FAMILY_REQUIRED' });
  expect((await f.h.rows<MediaRecord>('media_files'))[0].state).toBe('failed');
  await expect(receiveReview({ database: f.h.database, now: () => f.h.now, accountActive: f.h.accountActive }, 'late-trace', 'pass')).rejects.toBeDefined();
});
