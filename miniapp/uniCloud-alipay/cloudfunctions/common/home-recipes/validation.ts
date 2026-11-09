import type { Ingredient, RecipeInput, RecipeMutation, RecipeUpdate, RecipeListInput, RecipeFavoriteMutation } from 'home-contracts';
import { AppError } from 'home-kernel';

export function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...keys, ...optional].includes(key))) throw new AppError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, multiline = false, preserve = false): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max
    || /\p{Cc}/u.test(multiline ? value.replace(/[\n\r\t]/g, '') : value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new AppError('INVALID_INPUT');
  return preserve ? value : value.trim();
}
function nullableText(value: unknown, max: number, multiline = false): string | null {
  return value === null ? null : text(value, max, multiline);
}
function number(value: unknown, max: number, zero = false): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value > max || (zero ? value < 0 : value <= 0)) throw new AppError('INVALID_INPUT');
  return value;
}
export const recipeKeys = ['title', 'description', 'baseServings', 'prepMinutes', 'cookMinutes', 'ingredients', 'steps', 'tags'] as const;
export function recipeInput(value: unknown): RecipeInput {
  const row = exact(value, recipeKeys);
  if (!Array.isArray(row.ingredients) || row.ingredients.length < 1 || row.ingredients.length > 100
    || !Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 50
    || !Array.isArray(row.tags) || row.tags.length > 20) throw new AppError('INVALID_INPUT');
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw new AppError('INVALID_INPUT'); }
  if (Buffer.byteLength(serialized, 'utf8') > 32768) throw new AppError('INVALID_INPUT');
  return {
    title: text(row.title, 120), description: nullableText(row.description, 2000, true),
    baseServings: number(row.baseServings, 10000), prepMinutes: number(row.prepMinutes, 10080, true), cookMinutes: number(row.cookMinutes, 10080, true),
    ingredients: row.ingredients.map((value): Ingredient => {
      const item = exact(value, ['raw', 'name', 'quantity', 'unit', 'note']);
      return { raw: text(item.raw, 500, true, true), name: text(item.name, 100), quantity: number(item.quantity, 1000000),
        unit: nullableText(item.unit, 40), note: nullableText(item.note, 500, true) };
    }),
    steps: row.steps.map(value => text(value, 2000, true)), tags: row.tags.map(value => text(value, 40)),
  };
}
export function mutation(value: unknown, update: false): RecipeMutation;
export function mutation(value: unknown, update: true): RecipeUpdate;
export function mutation(value: unknown, update: boolean): RecipeMutation | RecipeUpdate {
  const row = exact(value, ['requestId', 'familyId', 'generation', 'recipe', ...(update ? ['id', 'version'] : [])]);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)) throw new AppError('INVALID_INPUT');
  const base = { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128), recipe: recipeInput(row.recipe) };
  if (!update) return base;
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= Number.MAX_SAFE_INTEGER) throw new AppError('INVALID_INPUT');
  return { ...base, id: recipeId(row.id), version: row.version };
}
export function recipeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new AppError('INVALID_INPUT');
  return value;
}
export function auditText(input: RecipeInput): string {
  return [input.title, input.description, ...input.ingredients.flatMap(item => [item.raw, item.name, item.unit, item.note]), ...input.steps, ...input.tags].filter(value => value !== null).join('\n');
}
export function listInput(value: unknown): Required<Omit<RecipeListInput, 'cursor'>> & { cursor?: string } {
  const row = exact(value, [], ['query', 'tag', 'cursor', 'limit', 'favoritesOnly']);
  function filter(value: unknown, max: number) {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new AppError('INVALID_INPUT');
    // Whitespace-only filters still reject control characters and excessive length.
    return text('x' + value, max + 1).slice(1).trim();
  }
  const limit = row.limit === undefined ? 20 : row.limit; const favoritesOnly = row.favoritesOnly === undefined ? false : row.favoritesOnly;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || typeof favoritesOnly !== 'boolean'
    || row.cursor !== undefined && (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor))) throw new AppError('INVALID_INPUT');
  return { query: filter(row.query, 120).replace(/[A-Z]/g, letter => letter.toLowerCase()), tag: filter(row.tag, 40), limit, favoritesOnly, ...(row.cursor === undefined ? {} : { cursor: row.cursor as string }) };
}
export function favoriteMutation(value: unknown): RecipeFavoriteMutation {
  const row = exact(value, ['requestId', 'familyId', 'generation', 'id', 'enabled']);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId) || typeof row.enabled !== 'boolean') throw new AppError('INVALID_INPUT');
  return { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128), id: recipeId(row.id), enabled: row.enabled };
}
