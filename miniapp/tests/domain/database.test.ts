import { expect, test } from 'vitest';
import { createMemoryDatabase } from '../support/memory-database';
import { readFile } from 'node:fs/promises';

test('commits_all_records_or_none', async () => {
  const memory = createMemoryDatabase();
  await expect(memory.database.transaction(async tx => {
    await tx.insert('families', 'home', { _id: 'home', name: '我家' });
    await tx.insert('family_members', 'alice', { _id: 'alice', familyId: 'home' });
    throw new Error('write failed');
  })).rejects.toThrow('write failed');
  expect(await memory.rows('families')).toEqual([]);
  expect(await memory.rows('family_members')).toEqual([]);
  await memory.database.transaction(async tx => {
    await tx.insert('families', 'home', { _id: 'home', name: '我家' });
    await tx.insert('family_members', 'alice', { _id: 'alice', familyId: 'home' });
  });
  expect(await memory.rows('families')).toEqual([{ _id: 'home', name: '我家' }]);
  expect(await memory.rows('family_members')).toEqual([{ _id: 'alice', familyId: 'home' }]);
});

test('insert_never_overwrites_existing_id', async () => {
  const memory = createMemoryDatabase();
  memory.seed('family_members', 'alice', { _id: 'alice', familyId: 'original' });
  await expect(memory.database.transaction(tx => tx.insert('family_members', 'alice', { _id: 'alice', familyId: 'other' })))
    .rejects.toMatchObject({ kind: 'conflict' });
  expect(await memory.rows('family_members')).toEqual([{ _id: 'alice', familyId: 'original' }]);
});

test('competing_uid_inserts_cannot_both_commit', async () => {
  const memory = createMemoryDatabase();
  const barrier = memory.barrierNextCommit();
  const first = memory.database.transaction(tx => tx.insert('family_members', 'alice', { _id: 'alice', familyId: 'first' }));
  await barrier.reached;
  await memory.database.transaction(tx => tx.insert('family_members', 'alice', { _id: 'alice', familyId: 'second' }));
  barrier.release();
  await expect(first).rejects.toMatchObject({ kind: 'conflict' });
  expect(await memory.rows('family_members')).toEqual([{ _id: 'alice', familyId: 'second' }]);
});

test('read_set_changes_abort_stale_writer', async () => {
  const memory = createMemoryDatabase();
  memory.seed('family_members', 'alice', { _id: 'alice', active: true });
  const barrier = memory.barrierNextCommit(); let attempts = 0;
  const writing = memory.database.transaction(async tx => {
    attempts++;
    const member = await tx.get<{ active: boolean }>('family_members', 'alice');
    if (!member?.active) return 'revoked';
    await tx.insert('families', 'home', { _id: 'home' });
    return 'created';
  });
  await barrier.reached;
  await memory.database.transaction(tx => tx.replace('family_members', 'alice', { _id: 'alice', active: false }));
  barrier.release();
  expect(await writing).toBe('revoked');
  expect(attempts).toBe(2);
  expect(await memory.rows('families')).toEqual([]);
});

test('absence_read_detects_concurrent_insert', async () => {
  const memory = createMemoryDatabase(); const barrier = memory.barrierNextCommit();
  const first = memory.database.transaction(async tx => {
    if (await tx.get('family_members', 'alice')) return 'already-member';
    await tx.insert('families', 'home', { _id: 'home' });
    return 'created';
  });
  await barrier.reached;
  await memory.database.transaction(tx => tx.insert('family_members', 'alice', { _id: 'alice' }));
  barrier.release();
  expect(await first).toBe('already-member');
  expect(await memory.rows('families')).toEqual([]);
});

test('replace_missing_record_is_not_an_upsert', async () => {
  const memory = createMemoryDatabase();
  await expect(memory.database.transaction(tx => tx.replace('family_members', 'alice', { _id: 'alice' })))
    .rejects.toMatchObject({ kind: 'conflict' });
  expect(await memory.rows('family_members')).toEqual([]);
});

test('replace_preserves_omitted_fields_like_the_platform_update', async () => {
  const memory = createMemoryDatabase();
  memory.seed('families', 'home', { _id: 'home', a: 1, b: 2 });
  await memory.database.transaction(tx => tx.replace('families', 'home', { _id: 'home', a: 3 }));
  expect(await memory.rows('families')).toEqual([{ _id: 'home', a: 3, b: 2 }]);
});

test.each(['insert:families', 'insert:family_members', 'insert:mutation_receipts', 'commit'] as const)('failure_at_%s_leaves_no_partial_records', async stage => {
  const memory = createMemoryDatabase(); memory.failNext(stage);
  await expect(memory.database.transaction(async tx => {
    await tx.insert('families', 'home', { _id: 'home' });
    await tx.insert('family_members', 'alice', { _id: 'alice' });
    await tx.insert('mutation_receipts', 'receipt', { _id: 'receipt' });
  })).rejects.toThrow();
  expect(await memory.rows('families')).toEqual([]);
  expect(await memory.rows('family_members')).toEqual([]);
  expect(await memory.rows('mutation_receipts')).toEqual([]);
});

test('acknowledgement_loss_does_not_repeat_committed_callback', async () => {
  const memory = createMemoryDatabase(); memory.failNext('after-commit'); let calls = 0;
  await expect(memory.database.transaction(async tx => { calls++; await tx.insert('families', 'home', { _id: 'home' }); }))
    .rejects.toMatchObject({ kind: 'commit-unknown' });
  expect(calls).toBe(1);
  expect(await memory.rows('families')).toEqual([{ _id: 'home' }]);
});

test('rolled_back_writes_do_not_invalidate_another_snapshot', async () => {
  const memory = createMemoryDatabase(); memory.seed('family_members', 'alice', { _id: 'alice', active: true });
  const barrier = memory.barrierNextCommit(); let attempts = 0;
  const first = memory.database.transaction(async tx => {
    attempts++; await tx.get('family_members', 'alice');
    await tx.insert('families', 'home', { _id: 'home' });
  });
  await barrier.reached;
  await expect(memory.database.transaction(async tx => {
    await tx.replace('family_members', 'alice', { _id: 'alice', active: false }); throw new Error('abort');
  })).rejects.toThrow('abort');
  barrier.release(); await first;
  expect(attempts).toBe(1);
  expect(await memory.rows('family_members')).toEqual([{ _id: 'alice', active: true }]);
});

test('read_and_write_values_are_copied_and_record_ids_must_match', async () => {
  const memory = createMemoryDatabase(); const row = { _id: 'home', name: 'original' };
  await memory.database.transaction(tx => tx.insert('families', 'home', row)); row.name = 'changed';
  await memory.database.transaction(async tx => {
    const value = await tx.get<typeof row>('families', 'home'); value!.name = 'other';
  });
  expect(await memory.rows('families')).toEqual([{ _id: 'home', name: 'original' }]);
  await expect(memory.database.transaction(tx => tx.replace('families', 'home', { _id: 'forged' }))).rejects.toMatchObject({ kind: 'unavailable' });
});

test('business_schemas_deny_all_client_crud_and_member_index_is_not_unique', async () => {
  for (const collection of ['families', 'family_members', 'mutation_receipts', 'request_limits']) {
    const schema = JSON.parse(await readFile(new URL(`../../uniCloud-alipay/database/${collection}.schema.json`, import.meta.url), 'utf8'));
    expect(schema.permission).toEqual({ read: false, create: false, update: false, delete: false });
    expect(schema.required).toContain('_id');
  }
  const indexes = JSON.parse(await readFile(new URL('../../uniCloud-alipay/database/family_members.index.json', import.meta.url), 'utf8'));
  expect(indexes).toEqual([{ IndexName: 'familyId', MgoKeySchema: { MgoIndexKeys: [{ Name: 'familyId', Direction: '1' }], MgoIsUnique: false } }]);
});
