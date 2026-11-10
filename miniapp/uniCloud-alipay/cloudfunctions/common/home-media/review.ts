import { AppError } from 'home-kernel';
import type { MediaReviewPort } from './index';
interface Checker { imgSecCheck(input: { image: string; openid: string; scene: 3; version: 2 }): Promise<unknown> }
interface CheckerConstructor { new(options: { provider: 'mp-weixin'; appId: string; requestId: string }): Checker }
export function createWeixinMediaReview(options: {
  enabled: boolean; uid: string; appId: string; requestId: string; readOpenid(uid: string): Promise<unknown>; loadChecker?: () => CheckerConstructor;
}): MediaReviewPort {
  return { mode: options.enabled ? 'weixin' : 'disabled', async submit(_row, url) {
    if (!options.enabled || options.appId !== '__UNI__5FDC0D7') throw new AppError('UNAVAILABLE');
    const values = await options.readOpenid(options.uid);
    const openid = values && typeof values === 'object' ? (values as Record<string, unknown>)['mp_' + options.appId] ?? (values as Record<string, unknown>).mp : undefined;
    if (typeof openid !== 'string' || !openid.trim()) throw new AppError('UNAVAILABLE');
    const Checker = (options.loadChecker ?? (() => require('uni-sec-check') as CheckerConstructor))();
    const result = await new Checker({ provider: 'mp-weixin', appId: options.appId, requestId: options.requestId }).imgSecCheck({ image: url, openid, scene: 3, version: 2 });
    if (!result || typeof result !== 'object' || !('errCode' in result) || result.errCode !== 0 || !('traceId' in result)
      || typeof result.traceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.traceId)) throw new AppError('UNAVAILABLE');
    return result.traceId;
  } };
}
