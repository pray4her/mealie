import { expect, test } from 'vitest';
import { checkTemplateTypes } from '../../scripts/check-template-types.mjs';
test('uni_button_boolean_prop_has_real_line_diagnostic', async () => {
  const result = await checkTemplateTypes();
  expect(result.valid.exitCode).toBe(0);
  expect(result.invalid.exitCode).not.toBe(0);
  expect(result.invalid.output).toMatch(/invalid-button\.vue\(2,\d+\).*TS2322/);
  expect(result.invalid.output).toMatch(/number.*boolean/);
}, 30_000);
