import { createVisualClient } from './client';
export function createProductionClient() { return createVisualClient(uni.getLaunchOptionsSync().query?.fixture); }
