import { expect, test, vi } from 'vitest';
import { createDatabasePort, readDatabaseRecord } from '../../uniCloud-alipay/cloudfunctions/common/home-kernel/database-platform';

function fixture() {
  const get = vi.fn(async (): Promise<unknown> => ({ data: { _id: 'home', name: '我家' } }));
  const doc = { get, update: vi.fn(async () => ({ updated: 1 })), remove: vi.fn(async () => ({ deleted: 1 })) };
  const add = vi.fn(async (): Promise<unknown> => ({ id: 'home' }));
  const transaction = { collection: vi.fn(() => ({ doc: vi.fn(() => doc), add })),
    commit: vi.fn(async (): Promise<unknown> => ({})), rollback: vi.fn(async () => ({})) };
  const ordinaryGet = vi.fn(async (): Promise<unknown> => ({ data: [{ _id: 'home', name: '我家' }] }));
  const platform = { startTransaction: vi.fn(async () => transaction), collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: ordinaryGet })) })), command: { set: vi.fn((value: unknown) => ({ __set: value })) } };
  return { platform, transaction, get, doc, add, ordinaryGet };
}

test('ordinary_and_transaction_point_reads_use_their_actual_shapes', async () => {
  const { platform } = fixture();
  const database = createDatabasePort(platform, { maxAttempts: 3, backoff: async () => {} });
  expect(await readDatabaseRecord(platform, 'families', 'home')).toEqual({ _id: 'home', name: '我家' });
  expect(await database.transaction(tx => tx.get('families', 'home'))).toEqual({ _id: 'home', name: '我家' });
});

test('unknown_sdk_read_errors_are_safe_unavailable_faults', async () => {
  const f = fixture(); f.get.mockRejectedValueOnce({ code: 'FIXTURE_UNKNOWN', message: 'private backend details' });
  const database = createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} });
  await expect(database.transaction(tx => tx.get('families', 'home'))).rejects.toMatchObject({ kind: 'unavailable', message: 'Database unavailable' });
  expect(f.transaction.commit).not.toHaveBeenCalled();
  expect(f.transaction.rollback).toHaveBeenCalledTimes(1);
});

test.each([{}, { data: [] }, { data: undefined }, { data: {} }, { data: { _id: 'wrong' } }, { data: 'home' }, { errCode: 'FAILED', data: { _id: 'home' } }])('malformed_transaction_read_is_rejected_%j', async raw => {
  const f = fixture(); f.get.mockResolvedValueOnce(raw);
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} }).transaction(tx => tx.get('families', 'home')))
    .rejects.toMatchObject({ kind: 'unavailable' });
  expect(f.transaction.commit).not.toHaveBeenCalled();
});

test.each([{}, { data: null }, { data: { _id: 'home' } }, { data: [null] }, { data: [{ _id: 'one' }, { _id: 'two' }] }])('malformed_ordinary_read_is_rejected_%j', async raw => {
  const f = fixture(); f.ordinaryGet.mockResolvedValueOnce(raw);
  await expect(readDatabaseRecord(f.platform, 'families', 'home')).rejects.toMatchObject({ kind: 'unavailable' });
});

test('missing_documents_are_null_in_both_read_modes', async () => {
  const f = fixture(); f.get.mockResolvedValueOnce({ data: null }); f.ordinaryGet.mockResolvedValueOnce({ data: [] });
  expect(await readDatabaseRecord(f.platform, 'families', 'home')).toBeNull();
  expect(await createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} }).transaction(tx => tx.get('families', 'home'))).toBeNull();
});

test('unverified_conflict_like_messages_do_not_trigger_retries', async () => {
  const f = fixture(); f.get.mockRejectedValue({ code: 'FIXTURE_CONFLICT', message: 'Transaction conflict duplicate key' });
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} }).transaction(tx => tx.get('families', 'home')))
    .rejects.toMatchObject({ kind: 'unavailable' });
  expect(f.platform.startTransaction).toHaveBeenCalledTimes(1);
});

test('explicit_conflict_mapping_retries_at_most_three_times', async () => {
  // This code is deliberately fixture-only; it is not a verified alipay SDK code.
  const f = fixture(); f.get.mockRejectedValue({ code: 'FIXTURE_CONFLICT' }); const backoff = vi.fn(async () => {});
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff, conflictCodes: ['FIXTURE_CONFLICT'] }).transaction(tx => tx.get('families', 'home')))
    .rejects.toMatchObject({ kind: 'conflict' });
  expect(f.platform.startTransaction).toHaveBeenCalledTimes(3);
  expect(backoff.mock.calls).toHaveLength(2);
  expect(f.transaction.rollback).toHaveBeenCalledTimes(3);
});

test('commit_acknowledgement_loss_does_not_rerun_callback', async () => {
  const f = fixture(); f.transaction.commit.mockRejectedValueOnce(new Error('connection lost'));
  const callback = vi.fn(async () => 'result');
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} }).transaction(callback))
    .rejects.toMatchObject({ kind: 'commit-unknown' });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(f.platform.startTransaction).toHaveBeenCalledTimes(1);
});

test('fulfilled_void_commit_preserves_the_result_without_rollback_or_callback_replay', async () => {
  // @alipay/faas-server-sdk Transaction.commit resolves Promise<void> on success.
  const f = fixture(); f.transaction.commit.mockResolvedValueOnce(undefined);
  const backoff = vi.fn(async () => {}); const callback = vi.fn(async () => ({ confirmed: true }));
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff }).transaction(callback)).resolves.toEqual({ confirmed: true });
  expect(callback).toHaveBeenCalledTimes(1); expect(f.platform.startTransaction).toHaveBeenCalledTimes(1);
  expect(f.transaction.commit).toHaveBeenCalledTimes(1); expect(f.transaction.rollback).not.toHaveBeenCalled();
  expect(backoff).not.toHaveBeenCalled();
});

test.each([null, false, 0, '', [], { errCode: 'FAILED' }])('malformed_commit_confirmation_remains_unknown_without_replay_%j', async acknowledgement => {
  const f = fixture(); f.transaction.commit.mockResolvedValueOnce(acknowledgement);
  const callback = vi.fn(async () => 'result');
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} }).transaction(callback)).rejects.toMatchObject({ kind: 'commit-unknown' });
  expect(callback).toHaveBeenCalledTimes(1); expect(f.transaction.commit).toHaveBeenCalledTimes(1);
  expect(f.platform.startTransaction).toHaveBeenCalledTimes(1);
});

test('callback_error_is_preserved_even_when_rollback_fails', async () => {
  const f = fixture(); f.transaction.rollback.mockRejectedValueOnce(new Error('rollback failed')); const original = new Error('business failure');
  await expect(createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} }).transaction(async () => { throw original; }))
    .rejects.toBe(original);
  expect(f.transaction.commit).not.toHaveBeenCalled();
});

test('insert_uses_add_and_replace_cannot_upsert_or_mutate_id', async () => {
  const f = fixture(); const database = createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} });
  await database.transaction(async tx => {
    await tx.insert('families', 'home', { _id: 'home', name: '我家' });
    await tx.replace('families', 'home', { _id: 'home', name: '新名字' });
  });
  expect(f.add).toHaveBeenCalledWith({ _id: 'home', name: '我家' });
  expect(f.doc.update).toHaveBeenCalledWith({ name: '新名字' });
  f.doc.update.mockResolvedValue({ updated: 0 });
  await expect(database.transaction(tx => tx.replace('families', 'home', { _id: 'home' }))).rejects.toMatchObject({ kind: 'conflict' });
  await expect(database.transaction(tx => tx.insert('families', 'home', { _id: 'forged' }))).rejects.toMatchObject({ kind: 'unavailable' });
});

test('replace_sets_nested_objects_whole_instead_of_dot_path_merge', async () => {
  const f = fixture(); const database = createDatabasePort(f.platform, { maxAttempts: 3, backoff: async () => {} });
  const candidate = { title: '番茄炒蛋', baseServings: null, ingredients: [{ raw: '番茄 2个' }] };
  await database.transaction(tx => tx.replace('import_jobs', 'home', { _id: 'home', candidate, attempts: 1 }));
  expect(f.platform.command.set).toHaveBeenCalledWith(candidate);
  expect(f.doc.update).toHaveBeenCalledWith({ candidate: { __set: candidate }, attempts: 1 });
});
