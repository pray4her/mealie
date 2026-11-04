import { createCloudClient } from './cloud-client';
import { createSessionBoundary } from './session-boundary';
import { createAccountApi } from '../features/auth/api';
export function createProductionClient() {
  const boundary = createSessionBoundary({
    get: key => uni.getStorageSync(key), set: (key, value) => { uni.setStorageSync(key, value); }, remove: key => { uni.removeStorageSync(key); },
  });
  const objects = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>();
  const cloud = createCloudClient({ boundary, transport: async (object, method, input) => {
    let api = objects.get(object);
    if (!api) { api = uniCloud.importObject(object, { customUI: true }); objects.set(object, api!); }
    return api![method](input);
  } });
  return { account: createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => {
    const result = await uni.login({ provider: 'weixin' });
    if (!result.code) throw new Error('UNAVAILABLE'); return result.code;
  } }) };
}
