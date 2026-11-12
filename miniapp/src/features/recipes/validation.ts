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
export interface FieldIssue { path: (string | number)[]; message: string }
export class RecipeInputError extends AppError {
  constructor(public readonly issues: FieldIssue[]) { super('INVALID_INPUT'); }
}
export function parseInput(value: unknown): RecipeInput {
  let row: Record<string, unknown>;
  try { row = object(value, inputKeys); } catch { throw new RecipeInputError([{ path: ['_form'], message: '菜谱字段不完整，请重新载入后再试。' }]); }
  const issues: FieldIssue[] = [];
  function check<T>(path: FieldIssue['path'], message: string, read: () => T): T {
    try { return read(); } catch { issues.push({ path, message }); return undefined as T; }
  }
  function list(key: 'ingredients' | 'steps' | 'tags', min: number, max: number): unknown[] {
    const items = row[key];
    if (!Array.isArray(items) || items.length < min || items.length > max) { issues.push({ path: [key], message: `${key === 'ingredients' ? '食材' : key === 'steps' ? '步骤' : '标签'}需为 ${min}–${max} 项。` }); return []; }
    return items;
  }
  const result: RecipeInput = {
    title: check(['title'], '请输入有效菜名，最多 120 字。', () => text(row.title, 120)),
    description: check(['description'], '简介最多 2000 字，请移除无效字符。', () => optional(row.description, 2000, true)),
    baseServings: check(['baseServings'], '份数须大于 0 且不超过 10000；未注明可留空。', () => numeric(row.baseServings, 10000)),
    prepMinutes: check(['prepMinutes'], '准备时间须为 0–10080 分钟；未注明可留空。', () => numeric(row.prepMinutes, 10080, true)),
    cookMinutes: check(['cookMinutes'], '烹饪时间须为 0–10080 分钟；未注明可留空。', () => numeric(row.cookMinutes, 10080, true)),
    ingredients: list('ingredients', 1, 100).map((value, index): Ingredient => {
      const item = check(['ingredients', index, 'raw'], '食材字段不完整，请重新填写。', () => object(value, ['raw', 'name', 'quantity', 'unit', 'note']));
      if (!item) return undefined as unknown as Ingredient;
      const at = <T>(key: string, message: string, read: () => T) => check(['ingredients', index, key], message, read);
      return { raw: at('raw', '请输入食材原文，最多 500 字。', () => text(item.raw, 500, true, true)),
        name: at('name', '请输入食材名称，最多 100 字。', () => text(item.name, 100)),
        quantity: at('quantity', '数量须大于 0 且不超过 1000000；未注明请留空。', () => numeric(item.quantity, 1000000)),
        unit: at('unit', '单位最多 40 字，请移除无效字符。', () => optional(item.unit, 40)),
        note: at('note', '备注最多 500 字，请移除无效字符。', () => optional(item.note, 500, true)) };
    }),
    steps: list('steps', 1, 50).map((value, index) => check(['steps', index], '请输入做法，单步最多 2000 字。', () => text(value, 2000, true))),
    tags: list('tags', 0, 20).map((value, index) => check(['tags', index], '每个标签最多 40 字，请移除无效字符。', () => text(value, 40))),
  };
  if (issues.length) throw new RecipeInputError(issues);
  // encodeURIComponent counts UTF-8 bytes without relying on a browser TextEncoder.
  if (encodeURIComponent(JSON.stringify(result)).replace(/%[A-F0-9]{2}|./g, 'x').length > 32768) throw new RecipeInputError([{ path: ['_form'], message: '菜谱内容合计不能超过 32 KiB，请缩短简介、食材或步骤。' }]);
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
