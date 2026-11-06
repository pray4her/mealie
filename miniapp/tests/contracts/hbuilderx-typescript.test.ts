import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import ts from 'typescript';

test('cloud modules declare their runtime library when HBuilderX defaults to ES2021', () => {
  const configPath = resolve('tsconfig.cloud.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('.'));
  expect(parsed.errors).toEqual([]);
  // HBuilderX 5.34 checks with ES2021 and no explicit lib, independently of this config.
  // Keep the repository's stricter settings and resolve its actual deployed entry points.
  const options = { ...parsed.options, target: ts.ScriptTarget.ES2021, lib: undefined };
  const program = ts.createProgram(parsed.fileNames, options);
  const errors = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error);
  expect(errors.map(item => ({ code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, '\n') }))).toEqual([]);
});
