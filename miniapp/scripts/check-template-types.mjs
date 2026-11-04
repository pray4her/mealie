import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function checkTemplateTypes() {
  const parent = join(root, '.type-probes'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'button-'));
  async function run(file) {
    const config = join(dir, file + '.json');
    await writeFile(config, JSON.stringify({ extends: '../../tsconfig.json', include: [], exclude: [], files: [file + '.vue'] }));
    return new Promise((yes, no) => {
      const child = spawn(process.execPath, [resolve(root, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit', '--pretty', 'false', '-p', config], { cwd: root });
      let output = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
      child.once('error', no); child.once('close', exitCode => yes({ exitCode, output }));
    });
  }
  try {
    await writeFile(join(dir, 'valid-button.vue'), '<script setup lang="ts"></script>\n<template><button :loading="true" /></template>\n');
    await writeFile(join(dir, 'invalid-button.vue'), await readFile(join(root, 'tests/fixtures/invalid-button.vue')));
    const valid = await run('valid-button'); const invalid = await run('invalid-button');
    return { valid, invalid };
  } finally { await rm(dir, { recursive: true, force: true }); } // Exact random directory created above only.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkTemplateTypes();
  if (result.valid.exitCode !== 0 || !/invalid-button\.vue\(2,\d+\).*TS2322/.test(result.invalid.output) || !/number.*boolean/.test(result.invalid.output)) throw new Error('Template type probe failed: ' + JSON.stringify(result));
  console.log('Positive and negative template types verified');
}
