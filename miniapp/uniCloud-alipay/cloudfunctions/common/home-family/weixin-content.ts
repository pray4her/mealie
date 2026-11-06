import { AppError } from 'home-kernel';
import type { ContentPort } from 'home-kernel';

interface Checker { textSecCheck(input: { content: string; openid: string; scene: 1; version: 2 }): Promise<unknown> }
interface CheckerConstructor { new(options: { provider: 'mp-weixin'; appId: string; requestId: string }): Checker }
interface ContentOptions {
  uid: string; appId: string; requestId: string;
  /** Returns only wx_openid from the verified user's server-side record. */
  readOpenid: (uid: string) => Promise<unknown>;
  loadChecker?: () => CheckerConstructor;
  timeoutMs?: number;
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function createWeixinContentPort(options: ContentOptions): ContentPort {
  return {
    async checkText(content) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutMs = options.timeoutMs ?? 5000;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000) throw new AppError('UNAVAILABLE');
        return await Promise.race([
          check(content),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('UNAVAILABLE')), timeoutMs); }),
        ]);
      } catch { throw new AppError('UNAVAILABLE'); }
      finally { if (timer !== undefined) clearTimeout(timer); }
    },
  };
  async function check(content: string): Promise<'allowed' | 'rejected'> {
      if (options.appId !== '__UNI__5FDC0D7' || !options.requestId || !options.uid) throw new AppError('UNAVAILABLE');
      const values = await options.readOpenid(options.uid);
      const openid = object(values) ? values['mp_' + options.appId] ?? values.mp : undefined;
      if (typeof openid !== 'string' || !openid || openid.trim() !== openid) throw new AppError('UNAVAILABLE');
      const Checker = (options.loadChecker ?? (() => require('uni-sec-check') as CheckerConstructor))();
      const result = await new Checker({ provider: 'mp-weixin', appId: options.appId, requestId: options.requestId })
        .textSecCheck({ content, openid, scene: 1, version: 2 });
      if (!object(result) || typeof result.errMsg !== 'string' || !object(result.result) || typeof result.result.label !== 'string' || !result.result.label) throw new AppError('UNAVAILABLE');
      if (result.errCode === 0 && result.result.suggest === 'pass') return 'allowed';
      if (result.errCode === 'uni-sec-check-risk-content'
        && (result.result.suggest === 'review' || result.result.suggest === 'risky')) return 'rejected';
      throw new AppError('UNAVAILABLE');
  }
}
