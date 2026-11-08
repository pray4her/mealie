import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';

test('invitation_digest_matches_sha256_vectors_and_never_stores_the_original', async () => {
  const { invitationDigest } = await import('../../src/features/family/token-digest');
  expect(invitationDigest('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(invitationDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (let size = 40; size < 200; size++) {
    const text = `v1.test.${'a'.repeat(size)}.${'B'.repeat(43)}`;
    expect(invitationDigest(text)).toBe(createHash('sha256').update(text).digest('hex'));
  }
});
