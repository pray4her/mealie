import { createCloudClient } from './cloud-client';
import { createSessionBoundary } from './session-boundary';
import { createAccountApi } from '../features/auth/api';
import { createFamilyApi } from '../features/family/api';
import { createRecipesApi } from '../features/recipes/api';
import type { AppClient } from 'home-contracts';
export function createProductionClient(): AppClient {
  const boundary = createSessionBoundary({
    get: key => uni.getStorageSync(key), set: (key, value) => { uni.setStorageSync(key, value); }, remove: key => { uni.removeStorageSync(key); },
  });
  const objects = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>();
  const cloud = createCloudClient({ boundary, transport: async (object, method, input) => {
    let api = objects.get(object);
    if (!api) { api = uniCloud.importObject(object, { customUI: true }); objects.set(object, api!); }
    return api![method](input);
  } });
  return { recipes: createRecipesApi({ boundary, invoke: cloud.invoke }), family: createFamilyApi({ boundary, invoke: cloud.invoke }), account: createAccountApi({ boundary, wire: cloud.account, platformLogin: async () => {
    const result = await uni.login({ provider: 'weixin' });
    if (!result.code) throw new Error('UNAVAILABLE'); return result.code;
  } }) };
}
