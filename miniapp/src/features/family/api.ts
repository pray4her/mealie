import type { FamilyApi, FamilyView } from 'home-contracts';
import type { SessionBoundary } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { normalizeFamilyName, validRequestId } from './validation';

function parseView(value: unknown): FamilyView {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 5 || Object.keys(value).some(key => !['uid', 'familyId', 'generation', 'role', 'name'].includes(key))
    || !('uid' in value) || typeof value.uid !== 'string' || !value.uid.trim()
    || !('familyId' in value) || typeof value.familyId !== 'string' || !value.familyId.trim()
    || !('generation' in value) || typeof value.generation !== 'string' || !value.generation.trim()
    || !('role' in value) || (value.role !== 'owner' && value.role !== 'member')
    || !('name' in value)) throw new AppError('UNAVAILABLE');
  try { if (normalizeFamilyName(value.name) !== value.name) throw new AppError('UNAVAILABLE'); }
  catch { throw new AppError('UNAVAILABLE'); }
  return { uid: value.uid, familyId: value.familyId, generation: value.generation, role: value.role, name: value.name as string };
}

export type Invoke = <T>(object: string, method: string, input: unknown) => Promise<T>;
export function createFamilyApi({ invoke, boundary }: { invoke: Invoke; boundary: SessionBoundary }): FamilyApi {
  async function call(method: string, input: unknown): Promise<unknown> {
    try { return await invoke('family-co', method, input); }
    catch (error) {
      // invoke has finished boundary.run before we close; close must never drain itself.
      if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {});
      throw new AppError(errorCode(error));
    }
  }
  return {
    async current() { const value = await call('current', {}); return value === null ? null : parseView(value); },
    async create(input) {
      if (!input || Object.keys(input).length !== 2 || !validRequestId(input.requestId)) throw new AppError('INVALID_INPUT');
      const name = normalizeFamilyName(input.name);
      return parseView(await call('create', { requestId: input.requestId, name }));
    },
  };
}
