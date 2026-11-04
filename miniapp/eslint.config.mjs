import js from '@eslint/js';
// Explicit ESM config; keep package module semantics identical to the official CLI template.
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import parser from 'vue-eslint-parser';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'vendor/**', 'src/uni_modules/**', 'uniCloud-alipay/cloudfunctions/uni-id-co/**', '.type-probes/**', 'tests/fixtures/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  { files: ['**/*.vue'], languageOptions: { parser, parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] } }, rules: { 'vue/multi-word-component-names': 'off' } },
  { files: ['tests/support/**'], rules: { 'vue/one-component-per-file': 'off' } },
  { languageOptions: { globals: { uni: 'readonly', uniCloud: 'readonly', console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly', require: 'readonly', module: 'readonly' } }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], '@typescript-eslint/no-require-imports': 'off' } },
];
