import { expect, test } from 'vitest';
import { createInvitationTokens } from 'home-family';

test('rotating_active_key_preserves_old_credentials_until_old_version_is_retired', () => {
  let version = 'old'; const keys: Record<string, string> = { old: '01'.repeat(32), next: '02'.repeat(32) };
  const tokens = createInvitationTokens(() => ({ FAMILY_INVITATION_KEY_VERSION: version, FAMILY_INVITATION_KEYS: JSON.stringify(keys) }));
  const id = 'a'.repeat(32); const old = tokens.derive(tokens.currentVersion(), id);
  version = 'next'; const next = tokens.derive(tokens.currentVersion(), id);
  expect(next).not.toBe(old); expect(tokens.verify(old)).toEqual({ id, version: 'old' });
  expect(tokens.verify(next)).toEqual({ id, version: 'next' });
  delete keys.old; expect(() => tokens.verify(old)).toThrow('UNAVAILABLE');
});
test('token_verification_rejects_malformed_and_forged_values_without_secret_errors', () => {
  const tokens = createInvitationTokens(() => ({ FAMILY_INVITATION_KEY_VERSION: 'test', FAMILY_INVITATION_KEYS: JSON.stringify({ test: '01'.repeat(32) }) }));
  for (const value of ['', '123456', `v1.test.${'a'.repeat(32)}.${'A'.repeat(43)}`]) expect(() => tokens.verify(value)).toThrow('INVITATION_INVALID');
  expect(() => createInvitationTokens(() => ({ FAMILY_INVITATION_KEY_VERSION: 'test', FAMILY_INVITATION_KEYS: '{private-invalid' })).currentVersion()).toThrow('UNAVAILABLE');
});
