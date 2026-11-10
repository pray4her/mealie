import type { Page, Recipe, RecipesApi } from 'home-contracts';
import type { Invoke } from '../family/api';
import type { SessionBoundary } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, parseFavoriteMutation, parseImagesMutation, parseListInput, parseMutation, parseRecipe, validId } from './validation';

export function createRecipesApi({ invoke, boundary }: { invoke: Invoke; boundary: SessionBoundary }): RecipesApi {
  async function call(method: string, input: unknown): Promise<unknown> {
    try { return await invoke('recipes-co', method, input); }
    catch (error) {
      if (errorCode(error) === 'AUTH_REQUIRED') await boundary.close(async () => {}).catch(() => {});
      throw new AppError(errorCode(error));
    }
  }
  return {
    async create(input) { return parseRecipe(await call('create', parseMutation(input, false))); },
    async update(input) { return parseRecipe(await call('update', parseMutation(input, true))); },
    async bindImages(input) { return parseRecipe(await call('bindImages', parseImagesMutation(input))); },
    async get(id) { return parseRecipe(await call('get', validId(id))); },
    async favorite(input) { if (await call('favorite', parseFavoriteMutation(input)) !== null) throw new AppError('UNAVAILABLE'); },
    async list(input): Promise<Page<Recipe>> {
      const query = parseListInput(input);
      try {
        const value = object(await call('list', query), ['items', 'nextCursor']);
        if (!Array.isArray(value.items) || value.items.length > (input.limit ?? 20) || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(value.nextCursor)))) throw new Error();
        return { items: value.items.map(parseRecipe), nextCursor: value.nextCursor as string | null };
      } catch (error) { throw new AppError(error instanceof AppError && error.code !== 'INVALID_INPUT' ? error.code : 'UNAVAILABLE'); }
    },
  };
}
