import { expect, test } from 'vitest';
import { createRequestLimiter } from 'home-kernel';
test('login_bucket_rejects_eleventh_call', () => {
  const limiter = createRequestLimiter({ now: () => 0, windowMs: 60_000, maxPerWindow: 10, maxKeys: 2 });
  for (let i = 0; i < 10; i++) limiter.consume('ip:login');
  expect(() => limiter.consume('ip:login')).toThrowError(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }));
});
test('bucket_expires_after_60000ms', () => {
  let now = 0; const limiter = createRequestLimiter({ now: () => now, windowMs: 60_000, maxPerWindow: 1, maxKeys: 2 });
  limiter.consume('ip:login'); now = 60_000; expect(() => limiter.consume('ip:login')).not.toThrow();
});
test('key_capacity_fails_closed', () => {
  let now = 0; const limiter = createRequestLimiter({ now: () => now, windowMs: 60_000, maxPerWindow: 10, maxKeys: 2 });
  limiter.consume('a'); limiter.consume('b'); expect(() => limiter.consume('c')).toThrowError(expect.objectContaining({ code: 'QUOTA_EXCEEDED' }));
  now = 60_000; expect(() => limiter.consume('c')).not.toThrow();
});
