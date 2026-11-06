import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Intentionally independent: never execute the mini-program production plugin.
export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { nodeTransforms: [node => {
    if (node.type === 1 && ['view', 'text', 'button', 'input'].includes(node.tag)) {
      node.tag = `Uni${node.tag[0].toUpperCase()}${node.tag.slice(1)}`; node.tagType = 1;
    }
  }] } } })],
  resolve: { alias: {
    '@dcloudio/uni-app': fileURLToPath(new URL('./tests/support/uni-lifecycle.ts', import.meta.url)),
    'home-contracts': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-contracts/index.ts', import.meta.url)),
    'home-kernel': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-kernel/index.ts', import.meta.url)),
    'home-family': fileURLToPath(new URL('./uniCloud-alipay/cloudfunctions/common/home-family/index.ts', import.meta.url)),
  } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
