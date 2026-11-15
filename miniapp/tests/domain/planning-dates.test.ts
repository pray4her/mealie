import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Id, MealType, Mutation, Page, PlanAdd, PlanEntry, PlanFields, PlanListInput, PlanMutation, PlanningApi, PlanRemove, PlanUpdate } from 'home-contracts';
import type { CollectionName } from '../../uniCloud-alipay/cloudfunctions/common/home-kernel/database';
import { beijingToday, parseLocalDate, shiftLocalDate, weekDates } from '../../src/features/planning/dates';
import * as client from '../../src/features/planning/validation';
import * as cloud from '../../uniCloud-alipay/cloudfunctions/common/home-planning/validation';

const validDates = ['0001-01-01', '0099-12-31', '0096-02-29', '1900-02-28', '2000-02-29', '2024-02-29', '2026-11-13', '9999-12-31'];
const invalidDates: unknown[] = [
  '0000-01-01', '0100-02-29', '0099-02-29', '1900-02-29', '2026-02-29', '2024-02-30', '2024-04-31',
  '2024-00-01', '2024-13-01', '2024-01-00', '2024-01-32', '10000-01-01', '-001-01-01',
  '99-01-01', '2024-2-09', '2024-02-9', '2024/02/09', ' 2024-02-09', '2024-02-09 ', '2024-02-09\n',
  '2024-02-09\r', '２０２４-02-09', '', '2024-02-29T00:00:00Z', '2024-02-29T08:00:00+08:00',
  1709164800000, new Date('2024-02-29T00:00:00Z'), null, undefined, {}, ['2024-02-29'], true,
];
const invalidServings: unknown[] = [0, -0, -1, 10000.001, NaN, Infinity, -Infinity, '2', '0.5', '0x10', '1e2', '', undefined, false, {}, [1]];
const meals = ['breakfast', 'lunch', 'dinner', 'other'] as const;

// The same literal fixtures exercise independent client and service validators.
describe.each([
  { name: 'client', parseDate: parseLocalDate, ...client },
  { name: 'cloud', parseDate: cloud.parseLocalDate, ...cloud },
])('$name planning validation', ({ parseDate, parseTargetServings, parseMeal, parsePlanFields }) => {
  test.each(validDates)('preserves valid Gregorian date %s without year-1900 coercion', value => {
    expect(parseDate(value)).toBe(value);
  });
  test.each(invalidDates.map(value => ({ value })))('rejects malformed, normalized or non-date input $value', ({ value }) => {
    expect(() => parseDate(value)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test.each([null, 0.000001, Number.MIN_VALUE, 0.5, 1, 10000])('preserves nullable/fractional/maximum servings %s without defaults or rounding', value => {
    expect(parseTargetServings(value)).toBe(value);
  });
  test.each(invalidServings.map(value => ({ value })))('rejects nonnumeric, nonfinite or out-of-range typed servings $value', ({ value }) => {
    expect(() => parseTargetServings(value)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test.each(meals)('accepts the meal type %s without translation', meal => {
    expect(parseMeal(meal)).toBe(meal);
  });
  test.each(['', 'Dinner', ' dinner ', 'snack', null, undefined, 0, {}, ['dinner']].map(value => ({ value })))('rejects unknown or coerced meal $value', ({ value }) => {
    expect(() => parseMeal(value)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test.each(meals)('parses an exact frozen %s form without mutating or aliasing the draft', meal => {
    const draft = Object.freeze({ date: '0099-12-31', meal, targetServings: null });
    const result = parsePlanFields(draft);
    expect(result).toEqual({ date: '0099-12-31', meal, targetServings: null });
    expect(result).not.toBe(draft);
    result.date = '2024-02-29';
    expect(draft.date).toBe('0099-12-31');
  });
  test.each([0.000001, 0.5, 10000])('keeps valid target servings %s in the parsed form', targetServings => {
    expect(parsePlanFields({ date: '2000-02-29', meal: 'lunch', targetServings }))
      .toEqual({ date: '2000-02-29', meal: 'lunch', targetServings });
  });
  test.each([
    { date: '1900-02-29' }, { date: 1709164800000 }, { meal: 'snack' }, { meal: ['dinner'] },
    ...invalidServings.map(targetServings => ({ targetServings })),
  ])('rejects invalid form fields rather than bypassing scalar validation %#', patch => {
    expect(() => parsePlanFields({ date: '2024-02-29', meal: 'dinner', targetServings: null, ...patch }))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test.each(['date', 'meal', 'targetServings'])('rejects missing own form field %s rather than defaulting it', key => {
    const form: Record<string, unknown> = { date: '2024-02-29', meal: 'dinner', targetServings: null };
    delete form[key];
    expect(() => parsePlanFields(form)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => parsePlanFields(Object.assign(Object.create({ [key]: 'forged' }), form)))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test.each(['familyId', 'createdBy', 'recipeId', 'titleSnapshot', 'id', 'version', 'createdAt', 'updatedAt', 'sourceAvailable', 'coverImageId', 'unexpected'])('rejects extra/immutable form field %s', key => {
    expect(() => parsePlanFields({ date: '2024-02-29', meal: 'dinner', targetServings: null, [key]: 'forged' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test('rejects hidden and symbol extra fields instead of checking only enumerable keys', () => {
    const form = { date: '2024-02-29', meal: 'dinner', targetServings: null };
    expect(() => parsePlanFields({ ...form, [Symbol('extra')]: true })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => parsePlanFields(Object.defineProperty(form, 'titleSnapshot', { value: 'forged' })))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  test.each([null, undefined, [], '2024-02-29', 1].map(value => ({ value })))('rejects non-object plan form $value', ({ value }) => {
    expect(() => parsePlanFields(value)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});

test.each([
  ['', null], [' \t\n ', null], ['0.5', 0.5], ['.5', 0.5], ['1.', 1], [' 2.50 ', 2.5],
  ['0.000001', 0.000001], ['10000', 10000], ['10000.00', 10000],
] as const)('parses decimal serving text %j without treating a blank as zero', (text, expected) => {
  expect(client.parseServingsText(text)).toBe(expected);
});
test.each(['0', '-0', '-1', '10000.01', 'NaN', 'Infinity', '0x10', '0XFF', '0b10', '0o10', '1e2', '1E-2', '.', '1.2.3', '1,5', '1_000', '1 2', '2 portions', '9'.repeat(400)])('rejects non-decimal or invalid serving text %s', text => {
  expect(() => client.parseServingsText(text)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});

test.each([
  ['2026-11-13T15:59:59.999Z', '2026-11-13'],
  ['2026-11-13T16:00:00.000Z', '2026-11-14'],
  ['2026-11-13T16:05:00Z', '2026-11-14'],
  ['2026-11-14T00:05:00+08:00', '2026-11-14'], // Asia/Shanghai: the same instant.
  ['2026-11-13T08:05:00-08:00', '2026-11-14'], // America/Los_Angeles: the same instant.
  ['2026-12-31T16:00:00Z', '2027-01-01'],
  ['2024-02-28T16:00:00Z', '2024-02-29'],
  ['2024-03-10T01:30:00-08:00', '2024-03-10'],
  ['2024-03-10T03:30:00-07:00', '2024-03-10'], // US DST cannot move Beijing's calendar.
  ['0099-12-31T15:59:59Z', '0099-12-31'],
  ['0099-12-31T16:00:00Z', '0100-01-01'],
  ['0000-12-31T16:00:00Z', '0001-01-01'],
  ['9999-12-31T15:59:59.999Z', '9999-12-31'],
])('derives Beijing date from the instant %s rather than UTC or host date', (instant, expected) => {
  expect(beijingToday(Date.parse(instant))).toBe(expected);
});
test('uses epoch milliseconds without parsing them as a date string', () => {
  expect(beijingToday(0)).toBe('1970-01-01');
  expect(beijingToday(-28800001)).toBe('1969-12-31');
});
test.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, Date.parse('0000-12-31T15:59:59.999Z'), Date.parse('9999-12-31T16:00:00Z')])('rejects an invalid or out-of-domain Beijing instant %s', epoch => {
  expect(() => beijingToday(epoch)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});

test.each([
  ['2024-02-28', 1, '2024-02-29'], ['2024-02-29', 1, '2024-03-01'], ['2024-03-01', -1, '2024-02-29'],
  ['1900-02-28', 1, '1900-03-01'], ['2000-02-28', 1, '2000-02-29'],
  ['2026-04-30', 1, '2026-05-01'], ['2026-12-31', 1, '2027-01-01'], ['2027-01-01', -1, '2026-12-31'],
  ['2024-03-09', 2, '2024-03-11'], ['2024-11-02', 2, '2024-11-04'], // Cross US DST changes.
  ['0099-12-31', 1, '0100-01-01'], ['0100-01-01', -1, '0099-12-31'], ['0096-02-28', 1, '0096-02-29'],
  ['0001-01-01', 0, '0001-01-01'], ['0001-01-01', 1, '0001-01-02'],
  ['9999-12-31', 0, '9999-12-31'], ['9999-12-31', -1, '9999-12-30'],
  ['0001-01-01', 3652058, '9999-12-31'], ['9999-12-31', -3652058, '0001-01-01'],
] as const)('shifts %s by %s calendar days without DST or year-1900 corruption', (date, days, expected) => {
  expect(shiftLocalDate(date, days)).toBe(expected);
});
test.each([
  ['0001-01-01', -1], ['9999-12-31', 1], ['0001-01-01', 3652059],
  ['2024-01-01', 0.5], ['2024-01-01', NaN], ['2024-01-01', Infinity],
  ['2024-01-01', Number.MAX_SAFE_INTEGER], ['2024-01-01', Number.MAX_SAFE_INTEGER + 1],
] as const)('rejects out-of-domain or non-integral date shift %s / %s', (date, days) => {
  expect(() => shiftLocalDate(date, days)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
test.each(['1900-02-29', '2024-2-01', '2024-02-29T00:00:00Z', '0000-01-01'])('calendar helpers reject invalid date %s before arithmetic', date => {
  expect(() => shiftLocalDate(date, 0)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(() => weekDates(date)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
test.each(['2026-11-09', '2026-11-13', '2026-11-15'])('returns Monday-first week for %s, including a Sunday selection', date => {
  expect(weekDates(date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
});
test('week crosses a leap day without skipping or normalizing it', () => {
  expect(weekDates('2024-02-29')).toEqual(['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03']);
});
test('week crosses a year boundary while preserving chronological order', () => {
  expect(weekDates('2027-01-01')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
});
test.each(['0001-01-01', '0001-01-07'])('first domain week for %s never includes year zero', date => {
  expect(weekDates(date)).toEqual(['0001-01-01', '0001-01-02', '0001-01-03', '0001-01-04', '0001-01-05', '0001-01-06', '0001-01-07']);
});
test('week for year 0099 does not accidentally use 1999 weekdays', () => {
  expect(weekDates('0099-12-31')).toEqual(['0099-12-28', '0099-12-29', '0099-12-30', '0099-12-31', '0100-01-01', '0100-01-02', '0100-01-03']);
});
test.each(['9999-12-27', '9999-12-31'])('last domain week for %s truncates before year 10000', date => {
  expect(weekDates(date)).toEqual(['9999-12-27', '9999-12-28', '9999-12-29', '9999-12-30', '9999-12-31']);
});

test('contracts keep ownership and recipe snapshots out of editable mutation fields', () => {
  expectTypeOf<MealType>().toEqualTypeOf<'breakfast' | 'lunch' | 'dinner' | 'other'>();
  expectTypeOf<PlanFields>().toEqualTypeOf<{ date: string; meal: MealType; targetServings: number | null }>();
  expectTypeOf<PlanMutation>().toEqualTypeOf<Mutation & { familyId: Id; generation: string }>();
  expectTypeOf<PlanEntry>().toEqualTypeOf<PlanFields & {
    id: Id; familyId: Id; createdBy: Id | null; recipeId: Id; titleSnapshot: string;
    version: number; createdAt: number; updatedAt: number; sourceAvailable: boolean; coverImageId: Id | null;
  }>();
  expectTypeOf<PlanAdd>().toEqualTypeOf<PlanMutation & PlanFields & { recipeId: Id }>();
  expectTypeOf<PlanUpdate>().toEqualTypeOf<PlanMutation & PlanFields & { id: Id; version: number }>();
  expectTypeOf<PlanRemove>().toEqualTypeOf<PlanMutation & { id: Id; version: number }>();
  expectTypeOf<PlanListInput>().toEqualTypeOf<{ from: string; to: string; cursor?: string; limit?: number }>();
  expectTypeOf<PlanningApi>().toEqualTypeOf<{
    add(input: PlanAdd): Promise<PlanEntry>;
    list(input: PlanListInput): Promise<Page<PlanEntry>>;
    get(id: Id): Promise<PlanEntry>;
    update(input: PlanUpdate): Promise<PlanEntry>;
    remove(input: PlanRemove): Promise<void>;
  }>();
  expectTypeOf<'meal_plans'>().toExtend<CollectionName>();
});

test('plan storage denies every clientDB operation and excludes read-time derived media fields', () => {
  const schema = JSON.parse(readFileSync(new URL('../../uniCloud-alipay/database/meal_plans.schema.json', import.meta.url), 'utf8'));
  expect(schema.permission).toEqual({ read: false, create: false, update: false, delete: false });
  const storedFields = ['_id', 'familyId', 'createdBy', 'recipeId', 'titleSnapshot', 'version', 'createdAt', 'updatedAt', 'date', 'meal', 'targetServings'];
  expect(schema.required).toEqual(expect.arrayContaining(storedFields));
  expect(schema.required).toHaveLength(storedFields.length);
  expect(Object.keys(schema.properties).sort()).toEqual(storedFields.sort());
  expect(schema.properties.version).toMatchObject({ minimum: 1 });
  expect(schema.properties.meal.enum).toEqual(['breakfast', 'lunch', 'dinner', 'other']);
});
test('plan index supports ascending family/date keyset paging without deduplicating repeated recipes', () => {
  const indexes = JSON.parse(readFileSync(new URL('../../uniCloud-alipay/database/meal_plans.index.json', import.meta.url), 'utf8'));
  expect(indexes).toHaveLength(1);
  expect(indexes[0].MgoKeySchema).toEqual({
    MgoIndexKeys: [{ Name: 'familyId', Direction: '1' }, { Name: 'date', Direction: '1' }, { Name: 'createdAt', Direction: '1' }, { Name: '_id', Direction: '1' }],
    MgoIsUnique: false,
  });
});
test('plan receipt operations are allowed without opening clientDB access', () => {
  const schema = JSON.parse(readFileSync(new URL('../../uniCloud-alipay/database/mutation_receipts.schema.json', import.meta.url), 'utf8'));
  expect(schema.properties.operation.enum).toEqual(expect.arrayContaining(['plan-add-v1', 'plan-update-v1', 'plan-remove-v1']));
  expect(schema.permission).toEqual({ read: false, create: false, update: false, delete: false });
});
