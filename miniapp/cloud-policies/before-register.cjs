/** @param {{userRecord:Record<string,unknown>,clientInfo:{appId:string,uniPlatform:string}}} input */
async function beforeRegister({ userRecord, clientInfo }) {
  if (clientInfo.appId !== '__UNI__5FDC0D7' || clientInfo.uniPlatform !== 'mp-weixin'
    || !userRecord.wx_openid || typeof userRecord.wx_openid !== 'object'
    || !('mp' in userRecord.wx_openid) || typeof userRecord.wx_openid.mp !== 'string' || !userRecord.wx_openid.mp
    || Object.keys(userRecord).some(key => /^(password|username)/i.test(key))
    || (userRecord.role !== undefined && (!Array.isArray(userRecord.role) || userRecord.role.length > 0))) {
    throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  }
  return { ...userRecord, status: 0, role: [] };
}
module.exports = { beforeRegister };
