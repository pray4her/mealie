import { expect, test, vi } from 'vitest';
import { createWeixinContentPort } from '../../uniCloud-alipay/cloudfunctions/common/home-family/weixin-content';

test('only_verified_uid_openid_and_platform_request_context_reach_v2_checker', async () => {
  const textSecCheck = vi.fn(async () => ({ errCode: 0, errMsg: '', result: { suggest: 'pass', label: '正常' } }));
  const readOpenid = vi.fn(async () => ({ mp___UNI__5FDC0D7: 'trusted-openid', mp: 'legacy' }));
  const context = vi.fn();
  class Checker { constructor(options: unknown) { context(options); } textSecCheck = textSecCheck; }
  const content = createWeixinContentPort({ uid: 'verified-user', appId: '__UNI__5FDC0D7', requestId: 'platform-request', readOpenid, loadChecker: () => Checker });
  expect(await content.checkText('我家')).toBe('allowed');
  expect(readOpenid).toHaveBeenCalledWith('verified-user');
  expect(context).toHaveBeenCalledWith({ provider: 'mp-weixin', appId: '__UNI__5FDC0D7', requestId: 'platform-request' });
  expect(textSecCheck).toHaveBeenCalledWith({ content: '我家', openid: 'trusted-openid', scene: 1, version: 2 });
});

test.each(['review', 'risky'])('official_risk_status_%s_is_rejected', async suggest => {
  class Checker { async textSecCheck() { return { errCode: 'uni-sec-check-risk-content', errMsg: '', result: { suggest, label: '其他' } }; } }
  const content = createWeixinContentPort({ uid: 'verified', appId: '__UNI__5FDC0D7', requestId: 'request', readOpenid: async () => ({ mp: 'legacy-trusted' }), loadChecker: () => Checker });
  expect(await content.checkText('我家')).toBe('rejected');
});

test.each([null, {}, { errCode: '0', errMsg: '', result: { suggest: 'pass', label: '正常' } },
  { errCode: 0, errMsg: '', result: { suggest: 'pass' } }, { errCode: 0, result: { suggest: 'pass', label: '正常' } },
  { errCode: 0, errMsg: '', result: { suggest: 'unknown', label: '其他' } },
  { errCode: 'unknown', errMsg: '', result: { suggest: 'pass', label: '正常' } },
  { errCode: 'unknown', errMsg: '', result: { suggest: 'risky', label: '其他' } },
  { errCode: 'uni-sec-check-risk-content', errMsg: '', result: { suggest: 'pass', label: '正常' } }])('malformed_or_unknown_result_is_unavailable_%j', async raw => {
  class Checker { async textSecCheck() { return raw; } }
  const content = createWeixinContentPort({ uid: 'verified', appId: '__UNI__5FDC0D7', requestId: 'request', readOpenid: async () => ({ mp: 'trusted' }), loadChecker: () => Checker });
  await expect(content.checkText('我家')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

test.each([null, {}, { mp: '' }, { mp: 123 }, { mp___UNI__5FDC0D7: 123, mp: 'legacy' }])('missing_or_malformed_openid_never_reaches_checker_%j', async values => {
  const loadChecker = vi.fn(() => class { async textSecCheck() { return { errCode: 0, errMsg: '', result: { suggest: 'pass', label: '正常' } }; } });
  const content = createWeixinContentPort({ uid: 'verified', appId: '__UNI__5FDC0D7', requestId: 'request', readOpenid: async () => values, loadChecker });
  await expect(content.checkText('我家')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  expect(loadChecker).not.toHaveBeenCalled();
});
test('untrusted_appid_and_empty_request_context_are_unavailable', async () => {
  for (const context of [{ appId: 'wx-client-forged', requestId: 'request' }, { appId: '__UNI__5FDC0D7', requestId: '' }]) {
    const content = createWeixinContentPort({ uid: 'verified', ...context, readOpenid: async () => ({ mp: 'trusted' }) });
    await expect(content.checkText('我家')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  }
});
test('timeout_including_openid_read_is_safe_and_late_completion_cannot_allow', async () => {
  vi.useFakeTimers();
  try {
    const content = createWeixinContentPort({ uid: 'verified', appId: '__UNI__5FDC0D7', requestId: 'request', readOpenid: () => new Promise(() => {}), timeoutMs: 100 });
    const result = expect(content.checkText('我家')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(100); await result;
  } finally { vi.useRealTimers(); }
}, 1000);
test('sdk_errors_are_sanitized', async () => {
  class Checker { async textSecCheck(): Promise<never> { throw new Error('private secret error'); } }
  const content = createWeixinContentPort({ uid: 'verified', appId: '__UNI__5FDC0D7', requestId: 'request', readOpenid: async () => ({ mp: 'trusted' }), loadChecker: () => Checker });
  await expect(content.checkText('我家')).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
});
