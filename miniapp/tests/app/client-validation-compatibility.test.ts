import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { beforeAll, expect, test } from 'vitest';
import { createSessionBoundary } from '../../src/shared/session-boundary';
import { createMemoryStorage } from '../support/sdk-transport';

let family: typeof import('../../src/features/family/validation');
let membership: typeof import('../../src/features/family/membership-validation');
let recipes: typeof import('../../src/features/recipes/validation');
let familyApi: typeof import('../../src/features/family/api');

beforeAll(async () => {
  const files = ['shared/errors', 'features/family/validation', 'features/family/invitation-validation',
    'features/family/membership-validation', 'features/family/api', 'features/recipes/validation'];
  const sources = new Map(await Promise.all(files.map(async file => {
    const source = await readFile(new URL(`../../src/${file}.ts`, import.meta.url), 'utf8');
    // Match the mini-program build, which lowers unsupported regex literals to constructors.
    const { code } = await transformWithEsbuild(source, `${file}.ts`, { target: 'es2015', format: 'cjs' });
    return [file, code] as const;
  })));
  const modules = new Map<string, { exports: unknown }>();
  const androidRegExp = new Proxy(RegExp, { construct(target, args: [string, string?]) {
    if (String(args[0]).includes('\\p{')) throw new SyntaxError('Invalid property name');
    return Reflect.construct(target, args);
  } });
  function load<T>(file: string): T {
    let module = modules.get(file);
    if (!module) {
      module = { exports: {} }; modules.set(file, module);
      const code = sources.get(file); if (!code) throw new Error(`Unexpected module: ${file}`);
      runInNewContext(code, { module, exports: module.exports, RegExp: androidRegExp,
        require: (name: string) => load(posix.normalize(posix.join(posix.dirname(file), name))),
      }, { filename: `${file}.js` });
    }
    return module.exports as T;
  }
  family = load('features/family/validation'); membership = load('features/family/membership-validation');
  recipes = load('features/recipes/validation'); familyApi = load('features/family/api');
});

const memberInput = { requestId: 'android-membership-01', familyId: 'home', generation: 'member-generation' };
const recipe = { title: '汤🍲', description: '加热\n翻面\t继续\r完成', baseServings: null, prepMinutes: null, cookMinutes: 0,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['煮'], tags: [] };

test('android_accepts_a_successful_current_family_response', async () => {
  const view = { uid: 'alice', familyId: 'home', role: 'owner', generation: 'owner-generation', name: 'pray4her' };
  const api = familyApi.createFamilyApi({ boundary: createSessionBoundary(createMemoryStorage()), invoke: async <T>() => view as T });
  await expect(api.current()).resolves.toEqual(view);
  expect(family.normalizeFamilyName(' 家庭🍲 ')).toBe('家庭🍲');
});

test('android_accepts_membership_context_without_unicode_property_escapes', () => {
  expect(membership.membershipInput('leave', memberInput)).toEqual(memberInput);
});

test('android_accepts_recipe_text_and_preserves_allowed_multiline_controls', () => {
  expect(recipes.parseInput(recipe)).toEqual(recipe);
  expect(recipes.parseListInput({ query: ' SOUP🍲 ' })).toEqual({ query: 'soup🍲', tag: '' });
});

test('android_still_rejects_every_c0_and_c1_control_character', () => {
  for (const point of [...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 33 }, (_, index) => index + 127)]) {
    const text = `a${String.fromCharCode(point)}b`;
    expect(() => family.normalizeFamilyName(text)).toThrowError('INVALID_INPUT');
    expect(() => membership.membershipInput('leave', { ...memberInput, familyId: text })).toThrowError('INVALID_INPUT');
    expect(() => recipes.parseInput({ ...recipe, title: text })).toThrowError('INVALID_INPUT');
  }
});
