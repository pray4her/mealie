import type { Ingredient, Recipe, RecipeInput, RecipeMutation, RecipeUpdate, RecipeListInput, RecipeFavoriteMutation } from 'home-contracts';
import { AppError } from '../../shared/errors';

export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) throw new AppError('INVALID_INPUT');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, multiline = false, raw = false): string {
  // eslint-disable-next-line no-control-regex -- Explicit control ranges work on Android without Unicode property escapes.
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\u0000-\u001F\u007F-\u009F]/.test(multiline ? value.replace(/[\r\n\t]/g, '') : value)
    || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new AppError('INVALID_INPUT');
  return raw ? value : value.trim();
}
const optional = (value: unknown, max: number, multiline = false) => value === null ? null : text(value, max, multiline);
function numeric(value: unknown, max: number, zero = false): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value > max || (zero ? value < 0 : value <= 0)) throw new AppError('INVALID_INPUT');
  return value;
}
export const inputKeys = ['title', 'description', 'baseServings', 'prepMinutes', 'cookMinutes', 'ingredients', 'steps', 'tags'] as const;
export function parseInput(value: unknown): RecipeInput {
  const row = object(value, inputKeys);
  if (!Array.isArray(row.ingredients) || row.ingredients.length < 1 || row.ingredients.length > 100
    || !Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 50 || !Array.isArray(row.tags) || row.tags.length > 20) throw new AppError('INVALID_INPUT');
  const result: RecipeInput = {
    title: text(row.title, 120), description: optional(row.description, 2000, true),
    baseServings: numeric(row.baseServings, 10000), prepMinutes: numeric(row.prepMinutes, 10080, true), cookMinutes: numeric(row.cookMinutes, 10080, true),
    ingredients: row.ingredients.map((value): Ingredient => {
      const item = object(value, ['raw', 'name', 'quantity', 'unit', 'note']);
      return { raw: text(item.raw, 500, true, true), name: text(item.name, 100), quantity: numeric(item.quantity, 1000000), unit: optional(item.unit, 40), note: optional(item.note, 500, true) };
    }), steps: row.steps.map(value => text(value, 2000, true)), tags: row.tags.map(value => text(value, 40)),
  };
  // encodeURIComponent counts UTF-8 bytes without relying on a browser TextEncoder.
  if (encodeURIComponent(JSON.stringify(result)).replace(/%[A-F0-9]{2}|./g, 'x').length > 32768) throw new AppError('INVALID_INPUT');
  return result;
}
export function validId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new AppError('INVALID_INPUT');
  return value;
}
export function parseMutation(value: unknown, update: false): RecipeMutation;
export function parseMutation(value: unknown, update: true): RecipeUpdate;
export function parseMutation(value: unknown, update: boolean): RecipeMutation | RecipeUpdate {
  const row = object(value, ['requestId', 'familyId', 'generation', 'recipe', ...(update ? ['id', 'version'] : [])]);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)) throw new AppError('INVALID_INPUT');
  const base = { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128), recipe: parseInput(row.recipe) };
  if (!update) return base;
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= Number.MAX_SAFE_INTEGER) throw new AppError('INVALID_INPUT');
  return { ...base, id: validId(row.id), version: row.version };
}
export function editable(value: Recipe): RecipeInput { return Object.fromEntries(inputKeys.map(key => [key, value[key]])) as RecipeInput; }
export function parseRecipe(value: unknown): Recipe {
  try {
    const row = object(value, [...inputKeys, 'id', 'familyId', 'createdBy', 'version', 'createdAt', 'updatedAt', 'imageIds', 'source', 'authorLabel', 'isFavorite']);
    if (typeof row.isFavorite !== 'boolean') throw new Error();
    const source = object(row.source, ['kind', 'url', 'importJobId', 'warnings']);
    if (!['manual', 'text', 'image', 'url'].includes(String(source.kind)) || (source.url !== null && typeof source.url !== 'string')
      || (source.importJobId !== null && typeof source.importJobId !== 'string') || !Array.isArray(source.warnings) || source.warnings.length > 20
      || source.warnings.some(item => typeof item !== 'string' || item.length > 2000)
      || !Array.isArray(row.imageIds) || row.imageIds.length > 20 || row.imageIds.some(item => typeof item !== 'string' || !item || item.length > 128)) throw new Error();
    for (const key of ['version', 'createdAt', 'updatedAt']) if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || (row[key] as number) < (key === 'version' ? 1 : 0)) throw new Error();
    validId(row.id); text(row.familyId, 128); text(row.authorLabel, 100);
    if (row.createdBy !== null) text(row.createdBy, 128);
    const input = parseInput(Object.fromEntries(inputKeys.map(key => [key, row[key]])));
    return { ...row, ...input } as Recipe;
  } catch { throw new AppError('UNAVAILABLE'); }
}
export function parseListInput(value: unknown): RecipeListInput {
  const row = object(value, [], ['query', 'tag', 'cursor', 'limit', 'favoritesOnly']);
  function filter(value: unknown, max: number) {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new AppError('INVALID_INPUT');
    // Validate even an empty filter before trimming whitespace.
    return text('x' + value, max + 1).slice(1).trim();
  }
  if (row.limit !== undefined && (typeof row.limit !== 'number' || !Number.isSafeInteger(row.limit) || row.limit < 1 || row.limit > 20)
    || row.cursor !== undefined && (typeof row.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.cursor))
    || row.favoritesOnly !== undefined && typeof row.favoritesOnly !== 'boolean') throw new AppError('INVALID_INPUT');
  return { ...row, query: filter(row.query, 120).replace(/[A-Z]/g, letter => letter.toLowerCase()), tag: filter(row.tag, 40) } as RecipeListInput;
}
export function parseFavoriteMutation(value: unknown): RecipeFavoriteMutation {
  const row = object(value, ['requestId', 'familyId', 'generation', 'id', 'enabled']);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId) || typeof row.enabled !== 'boolean') throw new AppError('INVALID_INPUT');
  return { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128), id: validId(row.id), enabled: row.enabled };
}
export function parseImagesMutation(value: unknown): import('home-contracts').RecipeImagesMutation {
  const row = object(value, ['requestId', 'familyId', 'generation', 'id', 'version', 'imageIds']);
  if (typeof row.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(row.requestId)
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(row.imageIds) || row.imageIds.length > 20) throw new AppError('INVALID_INPUT');
  const imageIds = row.imageIds.map(validId); if (new Set(imageIds).size !== imageIds.length) throw new AppError('INVALID_INPUT');
  return { requestId: row.requestId, familyId: text(row.familyId, 128), generation: text(row.generation, 128), id: validId(row.id), version: row.version, imageIds };
}
