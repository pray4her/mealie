/**
 * @typedef {{appId:string,uniPlatform:string,clientIP?:string}} ClientInfo
 * @typedef {{getClientInfo:()=>ClientInfo,getUniIdToken:()=>string|undefined,getMethodName:()=>string,getParams:()=>unknown[],authInfo?:{uid:string},response?:object}} Context
 * @typedef {{_before:(this:Context)=>Promise<void>,loginByWeixin:(this:Context,input:unknown)=>Promise<unknown>,logout:(this:Context)=>Promise<unknown>}} Upstream
 * @param {{upstream:Upstream,requireIdentity:(token:string|undefined,info:ClientInfo,options:{refresh:boolean})=>Promise<{uid:string}>,limiter:{consume:(key:string)=>void}}} dependencies
 */
function createEntry({ upstream, requireIdentity, limiter }) {
  /** @param {string} code */
  const failure = code => Object.assign(new Error(code), { code });
  /** @param {unknown} input */
  const validate = input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !('code' in input)
      || typeof input.code !== 'string' || !input.code.trim() || input.code.length > 1024) throw failure('INVALID_INPUT');
  };
  return {
    /** @this {Context} */
    async _before() {
      const method = this.getMethodName(); const info = this.getClientInfo();
      if (!['loginByWeixin', 'logout'].includes(method)) throw failure('AUTH_REQUIRED');
      if (info.appId !== '__UNI__5FDC0D7' || info.uniPlatform !== 'mp-weixin') throw failure('AUTH_REQUIRED');
      if (method === 'loginByWeixin') {
        validate(this.getParams()[0]); limiter.consume(`${info.clientIP || 'unknown'}:loginByWeixin`);
      } else {
        // The pinned official auth middleware returns early for existing authInfo.
        // Set it BEFORE upstream lifecycle/accessControl; never mint on logout.
        this.authInfo = await requireIdentity(this.getUniIdToken(), info, { refresh: false });
      }
      await upstream._before.call(this);
    },
    /** @this {Context} @param {unknown} input */
    async loginByWeixin(input) { validate(input); return upstream.loginByWeixin.call(this, input); },
    /** @this {Context} */
    async logout() { return upstream.logout.call(this); },
    /** @this {Context} @param {unknown} error @param {unknown} result */
    _after(error, result) {
      if (error || !result || typeof result !== 'object') {
        const code = error && typeof error === 'object' && 'code' in error && ['AUTH_REQUIRED', 'INVALID_INPUT', 'QUOTA_EXCEEDED'].includes(String(error.code)) ? String(error.code) : 'UNAVAILABLE';
        return { errCode: code };
      }
      if (!('errCode' in result) || result.errCode !== 0) return { errCode: 'AUTH_REQUIRED' };
      // Never spread provider/user rows into the response.
      if (this.getMethodName() === 'loginByWeixin' && 'newToken' in result && result.newToken && typeof result.newToken === 'object'
        && 'token' in result.newToken && typeof result.newToken.token === 'string'
        && 'tokenExpired' in result.newToken && typeof result.newToken.tokenExpired === 'number') {
        return { errCode: 0, newToken: { token: result.newToken.token, tokenExpired: result.newToken.tokenExpired } };
      }
      return { errCode: 0 };
    },
  };
}
module.exports = { createEntry };
